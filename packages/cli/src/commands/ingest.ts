import { join, resolve, basename } from 'node:path';
import { stat, readFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { Command } from 'commander';
import {
  ingestSource,
  bulkIngest,
  isNotFoundError,
  readIndex,
  readPage,
  writePage,
  createEntityPage,
  createConceptPage,
  addCrosslinks,
  appendEntry,
  type IndexEntry,
  type IngestResult,
} from '@llmwiki/shared';
import { runCopilotCli, CopilotCliError } from '../copilot-cli.js';
import { resolveWikiRoot } from '../wiki-root.js';
export { type IngestResult, ingestSource } from '@llmwiki/shared';

/** Structured output the LLM returns after analysing a source. */
interface LlmAnalysis {
  summary: string;
  entities: Array<{ name: string; content: string; tags: string[] }>;
  concepts: Array<{ name: string; content: string; tags: string[] }>;
  crosslinks: Array<{ from: string; to: string[] }>;
}

/**
 * Register the `ingest` subcommand on the wiki command group.
 */
export function registerIngestCommand(wiki: Command): void {
  wiki
    .command('ingest')
    .description('Ingest source file(s) into the wiki knowledge base')
    .argument('[sources...]', 'Path(s) to source files or a directory (omit with --all for raw/)')
    .option('--all', 'Ingest all files from the raw/ directory', false)
    .option('--path <dir>', 'Target directory', '.')
    .option('--dry-run', 'Preview changes without writing files', false)
    .option('--force', 'Re-ingest even if source was already ingested', false)
    .action(async (sources: string[], options: { all: boolean; path: string; dryRun: boolean; force: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;

      try {
        await _ingestAction(sources, options, jsonMode);
      } catch (err) {
        if (err instanceof CopilotCliError) {
          if (jsonMode) {
            console.log(JSON.stringify({ error: err.message, code: err.code }));
          } else {
            console.error(`✗ ${err.message}`);
          }
          process.exitCode = 1;
        } else {
          throw err;
        }
      }
    });
}

async function _ingestAction(
  sources: string[],
  options: { all: boolean; path: string; dryRun: boolean; force: boolean },
  jsonMode: boolean,
): Promise<void> {
  const wikiRoot = resolveWikiRoot(options.path);

  // Determine if this is a bulk operation (--all or a single directory argument)
  if (options.all || (sources.length === 1 && await isDirectory(sources[0]))) {
    if (options.all) {
      // --all: use bulkIngest which recursively scans raw/
      const rawDir = join(wikiRoot, 'raw');

      const result = await bulkIngest(rawDir, wikiRoot, {
        dryRun: options.dryRun,
        force: options.force,
        onProgress: jsonMode ? undefined : (current, total, file) => {
          console.log(`Ingesting ${current}/${total}: ${file}`);
        },
      });

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.total === 0) {
        console.log('No source files found.');
      } else if (options.dryRun) {
        console.log(`Dry run — ${result.total} file(s) scanned`);
        console.log(`  Would ingest: ${result.ingested}`);
        console.log(`  Skipped: ${result.skipped}`);
      } else {
        console.log(`✓ Bulk ingest complete`);
        console.log(`  Ingested: ${result.ingested}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
        if (result.failed > 0) {
          for (const f of result.files.filter(f => f.status === 'failed')) {
            console.error(`  ✗ ${f.file}: ${f.error}`);
          }
          process.exitCode = 1;
        }
      }

      // LLM enrichment for each ingested file
      if (!options.dryRun && result.ingested > 0) {
        for (const f of result.files.filter(f => f.status === 'ingested')) {
          if (!jsonMode) console.log(`  Enriching: ${f.file}…`);
          await enrichWithCopilotCli(join(rawDir, f.file), wikiRoot, jsonMode);
        }
      }
      return;
    }

    // Directory argument: list top-level files only (non-recursive)
    const dir = resolve(sources[0]);
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => join(dir, e.name));

    if (files.length === 0) {
      if (jsonMode) {
        console.log(JSON.stringify({ command: 'ingest', total: 0, ingested: 0 }));
      } else {
        console.log('No source files found in directory.');
      }
      return;
    }

    let ingested = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const label = `[${i + 1}/${files.length}]`;
      try {
        if (!jsonMode) console.log(`${label} Ingesting: ${basename(file)}…`);
        await _ingestSingleFile(file, wikiRoot, options, jsonMode, label);
        ingested++;
      } catch {
        failed++;
      }
    }
    if (!jsonMode) {
      console.log(`\n✓ Directory ingest complete — ${ingested} ingested, ${failed} failed`);
    }
    if (failed > 0) process.exitCode = 1;
    return;
  }

  // File ingest — at least one source is required
  if (sources.length === 0) {
    console.error('✗ Please provide source file path(s) or use --all for bulk ingest.');
    process.exitCode = 1;
    return;
  }

  // Multiple files — ingest one by one with per-file reporting
  if (sources.length > 1) {
    let ingested = 0;
    let failed = 0;
    for (let i = 0; i < sources.length; i++) {
      const file = sources[i];
      const label = `[${i + 1}/${sources.length}]`;
      try {
        if (!jsonMode) console.log(`${label} Ingesting: ${basename(file)}…`);
        await _ingestSingleFile(file, wikiRoot, options, jsonMode, label);
        ingested++;
      } catch {
        failed++;
      }
    }
    if (!jsonMode) {
      console.log(`\n✓ Multi-file ingest complete — ${ingested} ingested, ${failed} failed`);
    }
    if (failed > 0) process.exitCode = 1;
    return;
  }

  // Single file
  const source = sources[0];

  try {
    await _ingestSingleFile(source, wikiRoot, options, jsonMode);
  } catch (err) {
    // Re-throw CopilotCliError so the top-level handler can format it
    if (err instanceof CopilotCliError) throw err;
    process.exitCode = 1;
  }
}

async function _ingestSingleFile(
  source: string,
  wikiRoot: string,
  options: { dryRun: boolean; force: boolean },
  jsonMode: boolean,
  label?: string,
): Promise<void> {
  const prefix = label ? `${label} ` : '';

  // Copy source to .wiki/raw/ if not already there (matches extension behavior)
  const rawDir = join(wikiRoot, 'raw');
  const resolvedSource = resolve(source);
  const resolvedRaw = resolve(rawDir);
  let ingestPath = source;
  let forceIngest = options.force;

  if (!resolvedSource.startsWith(resolvedRaw + (process.platform === 'win32' ? '\\' : '/'))) {
    const fileName = basename(resolvedSource);
    const rawDest = join(rawDir, fileName);
    if (!options.dryRun) {
      await mkdir(rawDir, { recursive: true });
      await copyFile(resolvedSource, rawDest);
      if (!jsonMode) console.log(`${prefix}✓ Copied ${basename(resolvedSource)} → raw/`);
    }
    ingestPath = rawDest;
    // User explicitly asked to ingest this file — always overwrite
    forceIngest = true;
  }

  const result = await ingestSource(ingestPath, wikiRoot, options.dryRun, forceIngest);

  if (result.status === 'error') {
    if (jsonMode) {
      console.log(JSON.stringify(result));
    } else {
      console.error(`${prefix}✗ ${result.error}`);
    }
    throw new Error(result.error);
  } else if (result.status === 'skipped') {
    if (jsonMode) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`${prefix}⊘ ${result.message}`);
    }
  } else if (result.dry_run) {
    if (jsonMode) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`${prefix}Dry run — no files written`);
      console.log(`  Would create: ${result.pages_created.join(', ')}`);
      console.log(`  Would update: ${result.pages_updated.join(', ')}`);
    }
  } else {
    if (!jsonMode) {
      console.log(`${prefix}✓ Indexed: ${result.pages_created.join(', ')}`);
    }

    // LLM enrichment via Copilot CLI
    if (!jsonMode) console.log(`${prefix}  Analysing with LLM…`);
    const enrichResult = await enrichWithCopilotCli(ingestPath, wikiRoot, jsonMode);
    if (jsonMode) {
      console.log(JSON.stringify({
        ...result,
        enriched: enrichResult != null,
        entities: enrichResult?.entities.length ?? 0,
        concepts: enrichResult?.concepts.length ?? 0,
        crosslinks: enrichResult?.crosslinks.length ?? 0,
      }));
    } else if (enrichResult) {
      console.log(`${prefix}✓ LLM enrichment complete — ${enrichResult.entities.length} entities, ${enrichResult.concepts.length} concepts, ${enrichResult.crosslinks.length} crosslinks`);
    }
  }
}

/**
 * Enrich an ingested source using GitHub Copilot CLI.
 * Replicates the same LLM prompt and page-creation logic as the VS Code extension's llmIngest.
 */
async function enrichWithCopilotCli(
  sourcePath: string,
  wikiRoot: string,
  jsonMode: boolean,
): Promise<LlmAnalysis | null> {
  const wikiDir = join(wikiRoot, 'wiki');
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');

  // Read source content
  const sourceContent = await readFile(sourcePath, 'utf-8');
  const maxSourceChars = 60_000;
  const truncatedSource = sourceContent.length > maxSourceChars
    ? sourceContent.slice(0, maxSourceChars) + '\n\n[…truncated]'
    : sourceContent;

  // Read existing wiki context
  let existingEntries: IndexEntry[] = [];
  try {
    existingEntries = await readIndex(indexPath);
  } catch {
    // empty index
  }

  const wikiContext = existingEntries.length > 0
    ? existingEntries.map(e => `- [${e.title}](${e.path}) (${e.category}): ${e.summary}`).join('\n')
    : 'No existing wiki pages yet.';

  // Build the same prompt used by the VS Code extension
  const prompt = `You are a wiki knowledge-base builder. You analyse source documents and extract structured knowledge.

Given a source document and the existing wiki index, produce a JSON analysis with:
1. "summary": A rich markdown summary of the source (2-4 paragraphs). Include key findings, arguments, and data points.
2. "entities": Named things (people, organizations, products, places) worth their own wiki page. Each has "name", "content" (markdown body for the page), and "tags" (array of strings).
3. "concepts": Ideas, techniques, patterns, or topics worth their own wiki page. Each has "name", "content" (markdown body), and "tags".
4. "crosslinks": Links between pages. Each has "from" (relative path like "entities/foo.md" or "sources/bar-summary.md") and "to" (array of relative paths). Only link to pages that will exist after this analysis (existing pages from the index OR new entity/concept pages you are creating). Entity pages are at "entities/{slugified-name}.md", concept pages at "concepts/{slugified-name}.md". Slugify = lowercase, replace spaces/special chars with hyphens, remove consecutive hyphens.

Rules:
- Only create entities/concepts that are substantively discussed in the source, not just mentioned in passing.
- Keep content concise but informative (1-3 paragraphs per page).
- Use markdown formatting: headers, bold, lists.
- Tags should be lowercase, hyphenated keywords.
- If the source has minimal content, return fewer or no entities/concepts.
- Respond with ONLY valid JSON. No markdown fences, no explanation.

## Existing Wiki Pages
${wikiContext}

## Source Document
${truncatedSource}`;

  // Call Copilot CLI with a spinner
  let spinner: ReturnType<typeof setInterval> | undefined;
  if (!jsonMode) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const start = Date.now();
    process.stdout.write(`  ${frames[0]} Calling Copilot CLI…`);
    spinner = setInterval(() => {
      i = (i + 1) % frames.length;
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stdout.write(`\r  ${frames[i]} Calling Copilot CLI… ${elapsed}s`);
    }, 100);
  }
  let rawResponse: string;
  try {
    rawResponse = await runCopilotCli(prompt, { timeout: 180_000 });
  } finally {
    if (spinner) {
      clearInterval(spinner);
      process.stdout.write('\r  ✓ LLM response received     \n');
    }
  }
  const analysis = parseLlmResponse(rawResponse);

  if (!analysis) {
    if (!jsonMode) {
      console.error('  ⚠ Could not parse LLM response — skipping enrichment');
      console.error(`  Raw (first 500 chars): ${rawResponse.slice(0, 500)}`);
    }
    return null;
  }

  // Find the summary page that was created by mechanical ingest
  const { slugify } = await import('@llmwiki/shared');
  const { basename } = await import('node:path');
  const fileName = basename(sourcePath);
  const slug = slugify(fileName);
  const summaryRelPath = `sources/${slug}-summary.md`;

  // Rewrite summary with LLM content
  if (analysis.summary) {
    try {
      const summaryFullPath = join(wikiDir, summaryRelPath);
      const page = await readPage(summaryFullPath);
      page.body = analysis.summary;
      await writePage(summaryFullPath, page);
      if (!jsonMode) console.log(`  ✓ Rewrote summary: ${summaryRelPath}`);
    } catch {
      // Summary page may not exist
    }
  }

  // Create entity pages
  for (const entity of analysis.entities) {
    try {
      const result = await createEntityPage(wikiDir, entity.name, entity.content, entity.tags);
      const pagePath = join(wikiDir, result.path);
      const page = await readPage(pagePath);
      page.frontmatter.sources = [summaryRelPath];
      await writePage(pagePath, page);
      if (!jsonMode) console.log(`  + Entity: ${result.path}`);
    } catch (err) {
      if (!jsonMode) console.error(`  ⚠ Failed to create entity "${entity.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  // Create concept pages
  for (const concept of analysis.concepts) {
    try {
      const result = await createConceptPage(wikiDir, concept.name, concept.content, concept.tags);
      const pagePath = join(wikiDir, result.path);
      const page = await readPage(pagePath);
      page.frontmatter.sources = [summaryRelPath];
      await writePage(pagePath, page);
      if (!jsonMode) console.log(`  + Concept: ${result.path}`);
    } catch (err) {
      if (!jsonMode) console.error(`  ⚠ Failed to create concept "${concept.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  // Add crosslinks
  for (const link of analysis.crosslinks) {
    try {
      await addCrosslinks(wikiDir, link.from, link.to);
    } catch {
      // skip broken crosslinks
    }
  }

  // Log the enrichment
  await appendEntry(logPath, {
    verb: 'enriched',
    subject: summaryRelPath,
    details: `LLM created ${analysis.entities.length} entities, ${analysis.concepts.length} concepts, ${analysis.crosslinks.length} crosslinks.`,
  });

  return analysis;
}

function parseLlmResponse(raw: string): LlmAnalysis | null {
  let cleaned = raw.trim();

  // Extract JSON from markdown code fences (may appear anywhere in response)
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // If still not JSON, try to find the first { ... } block
  if (!cleaned.startsWith('{')) {
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart !== -1) {
      cleaned = cleaned.slice(jsonStart);
    }
  }

  // Trim trailing non-JSON text after the last }
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.filter(
            (e: unknown): e is { name: string; content: string; tags: string[] } =>
              typeof e === 'object' && e !== null &&
              typeof (e as Record<string, unknown>).name === 'string' &&
              typeof (e as Record<string, unknown>).content === 'string',
          ).map((e: { name: string; content: string; tags?: unknown }) => ({
            name: e.name,
            content: e.content,
            tags: Array.isArray(e.tags) ? e.tags.filter((t: unknown) => typeof t === 'string') : [],
          }))
        : [],
      concepts: Array.isArray(parsed.concepts)
        ? parsed.concepts.filter(
            (c: unknown): c is { name: string; content: string; tags: string[] } =>
              typeof c === 'object' && c !== null &&
              typeof (c as Record<string, unknown>).name === 'string' &&
              typeof (c as Record<string, unknown>).content === 'string',
          ).map((c: { name: string; content: string; tags?: unknown }) => ({
            name: c.name,
            content: c.content,
            tags: Array.isArray(c.tags) ? c.tags.filter((t: unknown) => typeof t === 'string') : [],
          }))
        : [],
      crosslinks: Array.isArray(parsed.crosslinks)
        ? parsed.crosslinks.filter(
            (l: unknown): l is { from: string; to: string[] } =>
              typeof l === 'object' && l !== null &&
              typeof (l as Record<string, unknown>).from === 'string' &&
              Array.isArray((l as Record<string, unknown>).to),
          ).map((l: { from: string; to: unknown[] }) => ({
            from: l.from,
            to: l.to.filter((t: unknown) => typeof t === 'string') as string[],
          }))
        : [],
    };
  } catch {
    return null;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

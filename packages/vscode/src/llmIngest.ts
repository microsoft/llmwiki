import * as vscode from 'vscode';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  ingestSource,
  readIndex,
  readPage,
  writePage,
  createEntityPage,
  createConceptPage,
  addCrosslinks,
  appendEntry,
  type IndexEntry,
} from '@llmwiki/shared';

/** Structured output the LLM returns after analysing a source. */
interface LlmAnalysis {
  summary: string;
  entities: Array<{ name: string; content: string; tags: string[] }>;
  concepts: Array<{ name: string; content: string; tags: string[] }>;
  crosslinks: Array<{ from: string; to: string[] }>;
}

/**
 * Ingest a source file with LLM-powered analysis.
 *
 * 1. Mechanical ingest (creates stub summary page, updates index/log)
 * 2. Send source content + existing wiki index to VS Code Copilot LLM
 * 3. LLM returns structured analysis: summary, entities, concepts, crosslinks
 * 4. Write the LLM-generated pages using @llmwiki/shared functions
 */
export async function llmIngest(
  sourcePath: string,
  workspaceFolder: string,
  force: boolean,
  outputChannel: vscode.OutputChannel,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<{ pagesCreated: string[]; pagesUpdated: string[] }> {
  const wikiDir = join(workspaceFolder, 'wiki');
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');
  const pagesCreated: string[] = [];
  const pagesUpdated: string[] = [];

  // ── Step 1: Mechanical ingest ────────────────────────────────
  progress.report({ message: 'Ingesting source file…' });
  const ingestResult = await ingestSource(sourcePath, workspaceFolder, false, force);

  if (ingestResult.status === 'error') {
    throw new Error(ingestResult.error ?? 'Ingest failed');
  }
  if (ingestResult.status === 'skipped') {
    throw new Error(ingestResult.message ?? 'Source already ingested. Use force to re-ingest.');
  }
  pagesCreated.push(...ingestResult.pages_created);
  pagesUpdated.push(...ingestResult.pages_updated);

  // ── Step 2: Read source content + existing wiki context ──────
  progress.report({ message: 'Reading source and wiki context…' });
  const sourceContent = await readFile(sourcePath, 'utf-8');

  let existingEntries: IndexEntry[] = [];
  try {
    existingEntries = await readIndex(indexPath);
  } catch {
    // Index may not parse; proceed with empty context
  }

  const wikiContext = existingEntries.length > 0
    ? existingEntries.map(e => `- [${e.title}](${e.path}) (${e.category}): ${e.summary}`).join('\n')
    : 'No existing wiki pages yet.';

  // ── Step 3: Call VS Code Copilot LLM ─────────────────────────
  progress.report({ message: 'Analysing with LLM…' });

  const analysis = await callLlm(sourceContent, wikiContext, outputChannel, token);
  if (!analysis) {
    outputChannel.appendLine('[llmIngest] LLM analysis returned nothing — skipping enrichment');
    return { pagesCreated, pagesUpdated };
  }

  // ── Step 4: Rewrite the summary page with LLM summary ───────
  if (analysis.summary && ingestResult.pages_created.length > 0) {
    progress.report({ message: 'Writing LLM summary…' });
    const summaryPath = join(wikiDir, ingestResult.pages_created[0]);
    const { readPage, writePage } = await import('@llmwiki/shared');
    try {
      const page = await readPage(summaryPath);
      page.body = analysis.summary;
      await writePage(summaryPath, page);
      pagesUpdated.push(ingestResult.pages_created[0]);
      outputChannel.appendLine(`[llmIngest] Rewrote summary: ${ingestResult.pages_created[0]}`);
    } catch (err) {
      outputChannel.appendLine(`[llmIngest] Failed to rewrite summary: ${err}`);
    }
  }

  // ── Step 5: Create entity pages ──────────────────────────────
  const sourceRelPath = ingestResult.pages_created[0] ?? '';
  for (const entity of analysis.entities) {
    progress.report({ message: `Creating entity: ${entity.name}…` });
    try {
      const result = await createEntityPage(wikiDir, entity.name, entity.content, entity.tags);
      // Tag with source for cleanup on removal
      const pagePath = join(wikiDir, result.path);
      const page = await readPage(pagePath);
      page.frontmatter.sources = [sourceRelPath];
      await writePage(pagePath, page);
      pagesCreated.push(result.path);
      outputChannel.appendLine(`[llmIngest] Created entity: ${result.path}`);
    } catch (err) {
      outputChannel.appendLine(`[llmIngest] Failed to create entity "${entity.name}": ${err}`);
    }
  }

  // ── Step 6: Create concept pages ─────────────────────────────
  for (const concept of analysis.concepts) {
    progress.report({ message: `Creating concept: ${concept.name}…` });
    try {
      const result = await createConceptPage(wikiDir, concept.name, concept.content, concept.tags);
      // Tag with source for cleanup on removal
      const pagePath = join(wikiDir, result.path);
      const page = await readPage(pagePath);
      page.frontmatter.sources = [sourceRelPath];
      await writePage(pagePath, page);
      pagesCreated.push(result.path);
      outputChannel.appendLine(`[llmIngest] Created concept: ${result.path}`);
    } catch (err) {
      outputChannel.appendLine(`[llmIngest] Failed to create concept "${concept.name}": ${err}`);
    }
  }

  // ── Step 7: Add crosslinks ───────────────────────────────────
  for (const link of analysis.crosslinks) {
    progress.report({ message: `Adding crosslinks from ${link.from}…` });
    try {
      await addCrosslinks(wikiDir, link.from, link.to);
      pagesUpdated.push(link.from);
      outputChannel.appendLine(`[llmIngest] Crosslinked ${link.from} → ${link.to.join(', ')}`);
    } catch (err) {
      outputChannel.appendLine(`[llmIngest] Failed to crosslink from "${link.from}": ${err}`);
    }
  }

  // ── Step 8: Log the enrichment ───────────────────────────────
  await appendEntry(logPath, {
    verb: 'enriched',
    subject: ingestResult.pages_created[0] ?? sourcePath,
    details: `LLM created ${analysis.entities.length} entities, ${analysis.concepts.length} concepts, ${analysis.crosslinks.length} crosslinks.`,
  });

  return { pagesCreated, pagesUpdated };
}

// ── LLM call ─────────────────────────────────────────────────────

async function callLlm(
  sourceContent: string,
  wikiContext: string,
  outputChannel: vscode.OutputChannel,
  token: vscode.CancellationToken,
): Promise<LlmAnalysis | null> {
  let model: vscode.LanguageModelChat;
  const preferredModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
  if (preferredModels.length > 0) {
    model = preferredModels[0];
  } else {
    outputChannel.appendLine('[llmIngest] claude-opus-4.6 not available — falling back to any Copilot model');
    const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (fallback.length === 0) {
      outputChannel.appendLine('[llmIngest] No Copilot model available — falling back to mechanical ingest');
      return null;
    }
    model = fallback[0];
  }

  outputChannel.appendLine(`[llmIngest] Using model: ${model.family}`);

  // Truncate very large sources to stay within context limits
  const maxSourceChars = 60_000;
  const truncatedSource = sourceContent.length > maxSourceChars
    ? sourceContent.slice(0, maxSourceChars) + '\n\n[…truncated]'
    : sourceContent;

  const systemPrompt = `You are a wiki knowledge-base builder. You analyse source documents and extract structured knowledge.

Given a source document and the existing wiki index, produce a JSON analysis with:
1. "summary": A rich markdown summary of the source (2-4 paragraphs). Include key findings, arguments, and data points. This replaces the mechanical preview.
2. "entities": Named things (people, organizations, products, places) worth their own wiki page. Each has "name", "content" (markdown body for the page), and "tags" (array of strings).
3. "concepts": Ideas, techniques, patterns, or topics worth their own wiki page. Each has "name", "content" (markdown body), and "tags".
4. "crosslinks": Links between pages. Each has "from" (relative path like "entities/foo.md" or "sources/bar-summary.md") and "to" (array of relative paths). Only link to pages that will exist after this analysis (existing pages from the index OR new entity/concept pages you are creating). Entity pages are at "entities/{slugified-name}.md", concept pages at "concepts/{slugified-name}.md". Slugify = lowercase, replace spaces/special chars with hyphens, remove consecutive hyphens.

Rules:
- Only create entities/concepts that are substantively discussed in the source, not just mentioned in passing.
- Keep content concise but informative (1-3 paragraphs per page).
- Use markdown formatting: headers, bold, lists.
- Tags should be lowercase, hyphenated keywords.
- If the source has minimal content, return fewer or no entities/concepts.
- Respond with ONLY valid JSON. No markdown fences, no explanation.`;

  const userMessage = `## Existing Wiki Pages
${wikiContext}

## Source Document
${truncatedSource}`;

  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  try {
    const response = await model.sendRequest(messages, {}, token);

    // Collect streamed response
    let fullResponse = '';
    for await (const chunk of response.text) {
      fullResponse += chunk;
    }

    outputChannel.appendLine(`[llmIngest] LLM response length: ${fullResponse.length} chars`);

    return parseLlmResponse(fullResponse, outputChannel);
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      outputChannel.appendLine(`[llmIngest] LLM error: ${err.message} (code: ${err.code})`);
    } else {
      outputChannel.appendLine(`[llmIngest] LLM error: ${err}`);
    }
    return null;
  }
}

function parseLlmResponse(raw: string, outputChannel: vscode.OutputChannel): LlmAnalysis | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate shape
    const analysis: LlmAnalysis = {
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

    outputChannel.appendLine(
      `[llmIngest] Parsed: summary=${analysis.summary.length > 0 ? 'yes' : 'no'}, ` +
      `entities=${analysis.entities.length}, concepts=${analysis.concepts.length}, ` +
      `crosslinks=${analysis.crosslinks.length}`,
    );

    return analysis;
  } catch (err) {
    outputChannel.appendLine(`[llmIngest] Failed to parse LLM JSON: ${err}`);
    outputChannel.appendLine(`[llmIngest] Raw response: ${raw.slice(0, 500)}`);
    return null;
  }
}

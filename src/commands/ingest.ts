import { Command } from 'commander';
import { readFile, stat, access, constants } from 'node:fs/promises';
import { join, resolve, basename, extname, relative } from 'node:path';
import { writePage, directoryExists } from '../lib/wiki.js';
import { addEntry } from '../lib/index.js';
import { appendEntry } from '../lib/log.js';

/**
 * Result of running the ingest command.
 */
export interface IngestResult {
  command: string;
  status: 'success' | 'error';
  pages_created: string[];
  pages_updated: string[];
  dry_run: boolean;
  error?: string;
}

/**
 * Slugify a filename: lowercase, strip extension, replace non-alphanumeric
 * sequences with hyphens, trim leading/trailing hyphens.
 */
function slugify(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  return nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Ingest a source file into the wiki knowledge base.
 *
 * Reads the source, creates a summary page in wiki/sources/,
 * updates wiki/index.md, and appends to wiki/log.md.
 */
export async function ingestSource(
  sourcePath: string,
  targetPath: string,
  dryRun: boolean,
): Promise<IngestResult> {
  const root = resolve(targetPath);
  const wikiDir = join(root, 'wiki');
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');

  // Validate wiki is initialized
  if (!(await directoryExists(wikiDir))) {
    return {
      command: 'ingest',
      status: 'error',
      pages_created: [],
      pages_updated: [],
      dry_run: dryRun,
      error: 'Wiki is not initialized. Run "plaid wiki init" first.',
    };
  }

  // Validate source file exists
  const resolvedSource = resolve(sourcePath);
  try {
    await access(resolvedSource, constants.R_OK);
  } catch {
    return {
      command: 'ingest',
      status: 'error',
      pages_created: [],
      pages_updated: [],
      dry_run: dryRun,
      error: `Source file not found: ${sourcePath}`,
    };
  }

  // Read source file
  const sourceContent = await readFile(resolvedSource, 'utf-8');
  const sourceStat = await stat(resolvedSource);
  const sourceFilename = basename(resolvedSource);
  const sourceExt = extname(resolvedSource);
  const slug = slugify(sourceFilename);
  const summaryRelPath = `sources/${slug}-summary.md`;
  const summaryFullPath = join(wikiDir, summaryRelPath);

  // Build content excerpt (first ~500 characters)
  const excerpt = sourceContent.length > 500
    ? sourceContent.slice(0, 500) + '…'
    : sourceContent;

  // Compute relative path from wiki root to source file
  const relativeSourcePath = relative(root, resolvedSource).replace(/\\/g, '/');

  const today = new Date().toISOString().slice(0, 10);

  const pagesCreated: string[] = [];
  const pagesUpdated: string[] = [];

  if (!dryRun) {
    // Create summary page
    await writePage(summaryFullPath, {
      frontmatter: {
        type: 'source',
        title: sourceFilename,
        source_path: relativeSourcePath,
        ingested: today,
        tags: [],
      },
      body: `# ${sourceFilename}\n\n**Source:** ${relativeSourcePath}  \n**Type:** ${sourceExt || 'unknown'}  \n**Size:** ${sourceStat.size} bytes  \n**Ingested:** ${today}\n\n## Content Preview\n\n${excerpt}`,
    });
    pagesCreated.push(summaryRelPath);

    // Update index
    await addEntry(indexPath, {
      path: summaryRelPath,
      title: sourceFilename,
      summary: `Source file (${sourceExt || 'unknown'})`,
      category: 'Sources',
      tags: [],
    });
    pagesUpdated.push('index.md');

    // Append to log
    await appendEntry(logPath, {
      verb: 'ingested',
      subject: sourceFilename,
      details: `Ingested source "${sourceFilename}" → ${summaryRelPath}`,
    });
    pagesUpdated.push('log.md');
  } else {
    pagesCreated.push(summaryRelPath);
    pagesUpdated.push('index.md', 'log.md');
  }

  return {
    command: 'ingest',
    status: 'success',
    pages_created: pagesCreated,
    pages_updated: pagesUpdated,
    dry_run: dryRun,
  };
}

/**
 * Register the `ingest` subcommand on the wiki command group.
 */
export function registerIngestCommand(wiki: Command): void {
  wiki
    .command('ingest')
    .description('Ingest a source file into the wiki knowledge base')
    .argument('<source>', 'Path to the source file to ingest')
    .option('--path <dir>', 'Target directory', '.')
    .option('--dry-run', 'Preview changes without writing files', false)
    .action(async (source: string, options: { path: string; dryRun: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await ingestSource(source, options.path, options.dryRun);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.status === 'error') {
        console.error(`✗ ${result.error}`);
        process.exitCode = 1;
      } else if (result.dry_run) {
        console.log('Dry run — no files written');
        console.log(`  Would create: ${result.pages_created.join(', ')}`);
        console.log(`  Would update: ${result.pages_updated.join(', ')}`);
      } else {
        console.log('✓ Source ingested successfully');
        console.log(`  Created: ${result.pages_created.join(', ')}`);
        console.log(`  Updated: ${result.pages_updated.join(', ')}`);
      }
    });
}

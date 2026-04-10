import { readFile, stat, access, constants } from 'node:fs/promises';
import { join, resolve, basename, extname, relative } from 'node:path';
import { writePage, directoryExists } from './wiki.js';
import { addEntry } from './index-ops.js';
import { appendEntry } from './log.js';
import { slugify } from './utils.js';

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

  // S-7: Prevent path traversal — source must be within project root
  const resolvedSource = resolve(sourcePath);
  const normalizedSource = resolvedSource.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/');
  if (!normalizedSource.startsWith(normalizedRoot + '/') && normalizedSource !== normalizedRoot) {
    return {
      command: 'ingest',
      status: 'error',
      pages_created: [],
      pages_updated: [],
      dry_run: dryRun,
      error: `Source path escapes project root: ${sourcePath}`,
    };
  }

  // Validate source file exists
  try {
    await access(resolvedSource, constants.R_OK);
  } catch {
    // ENOENT or EACCES — source file missing or not readable
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

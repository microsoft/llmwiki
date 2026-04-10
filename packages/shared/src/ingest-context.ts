import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { ingestSource, type IngestResult } from './ingest.js';
import { queryWiki, type QueryResult } from './query.js';

/** Info about a related wiki page */
export interface PageInfo {
  path: string;
  title: string;
  score: number;
  excerpt: string;
}

/** Enhanced ingest result with contextual information */
export interface IngestWithContextResult {
  /** Mechanical ingest result */
  ingest: IngestResult;
  /** Word count of the source document */
  source_word_count: number;
  /** Detected content type from file extension */
  source_content_type: string;
  /** Related wiki pages found via keyword overlap */
  related_pages: PageInfo[];
  /** Suggested next actions for the LLM */
  suggested_actions: string[];
}

// Common English stop words to filter out when extracting keywords
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'not', 'no', 'as', 'if', 'then',
  'than', 'so', 'such', 'when', 'where', 'how', 'what', 'which', 'who',
  'whom', 'we', 'he', 'she', 'they', 'you', 'i', 'me', 'my', 'your',
  'his', 'her', 'our', 'their', 'us', 'them', 'about', 'up', 'out',
  'just', 'also', 'very', 'all', 'any', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'only', 'own', 'same',
]);

/** Detect content type from file extension */
export function detectContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const typeMap: Record<string, string> = {
    '.md': 'markdown',
    '.txt': 'text',
    '.pdf': 'pdf',
    '.html': 'html',
    '.htm': 'html',
    '.json': 'json',
    '.csv': 'csv',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.rst': 'restructuredtext',
    '.tex': 'latex',
    '.doc': 'word',
    '.docx': 'word',
    '.rtf': 'richtext',
  };
  return typeMap[ext] ?? 'unknown';
}

/** Count words in text */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Extract keywords from text (first N words, stop words removed, deduplicated) */
export function extractKeywords(text: string, maxWords = 200): string[] {
  const words = text
    .slice(0, maxWords * 10) // rough char limit for perf
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate and take top unique words
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const w of words) {
    if (!seen.has(w) && keywords.length < maxWords) {
      seen.add(w);
      keywords.push(w);
    }
  }
  return keywords;
}

/** Generate suggested actions based on ingest result and context */
function generateSuggestedActions(
  ingestResult: IngestResult,
  relatedPages: PageInfo[],
): string[] {
  const actions: string[] = [];

  if (ingestResult.status === 'error') {
    actions.push('Fix the ingest error and retry');
    return actions;
  }

  if (ingestResult.status === 'skipped') {
    actions.push('Use force=true to re-ingest this source');
    return actions;
  }

  // Success case
  actions.push('Review the generated summary page for accuracy');
  actions.push(
    'Create entity pages for mentioned people, organizations, or concepts',
  );

  if (relatedPages.length > 0) {
    actions.push(
      'Add crosslinks between the new page and related existing pages',
    );
    actions.push(
      'Update existing related pages with new information from this source',
    );
  } else {
    actions.push(
      'Consider creating foundational concept pages to build wiki structure',
    );
  }

  actions.push('Update the wiki index if additional metadata is needed');

  return actions;
}

/**
 * Ingest a source and return enhanced result with context.
 *
 * Performs mechanical ingest via ingestSource(), then enriches the result
 * with word count, content type, related pages, and suggested actions.
 *
 * @param sourcePath  Path to the source file to ingest.
 * @param targetPath  Project root that contains the wiki/ directory.
 * @param dryRun      Simulate without writing files.
 * @param force       Re-ingest even if source was already processed.
 */
export async function ingestWithContext(
  sourcePath: string,
  targetPath: string,
  dryRun = false,
  force = false,
): Promise<IngestWithContextResult> {
  // Read source content for analysis (before ingest, so we can get word count even on error)
  let sourceContent = '';
  let wordCount = 0;
  const contentType = detectContentType(sourcePath);

  try {
    const resolvedSource = resolve(sourcePath);
    sourceContent = await readFile(resolvedSource, 'utf-8');
    wordCount = countWords(sourceContent);
  } catch {
    // If we can't read the source, ingestSource will handle the error
  }

  // Perform mechanical ingest
  const ingestResult = await ingestSource(sourcePath, targetPath, dryRun, force);

  // Find related pages if ingest succeeded and we have content
  let relatedPages: PageInfo[] = [];
  if (ingestResult.status !== 'error' && sourceContent.length > 0) {
    try {
      const keywords = extractKeywords(sourceContent);
      if (keywords.length > 0) {
        // Use first 20 keywords as query string for manageable query
        const queryStr = keywords.slice(0, 20).join(' ');
        const queryResult = await queryWiki(queryStr, targetPath, false);
        relatedPages = queryResult.results.map((r: QueryResult) => ({
          path: r.path,
          title: r.title,
          score: r.score,
          excerpt: r.excerpt,
        }));
        // Filter out the page we just created (it would match itself)
        const createdPaths = new Set([
          ...ingestResult.pages_created,
          ...ingestResult.pages_updated,
        ]);
        relatedPages = relatedPages.filter((p) => !createdPaths.has(p.path));
      }
    } catch {
      // If query fails, continue with empty related pages
    }
  }

  const suggestedActions = generateSuggestedActions(ingestResult, relatedPages);

  return {
    ingest: ingestResult,
    source_word_count: wordCount,
    source_content_type: contentType,
    related_pages: relatedPages,
    suggested_actions: suggestedActions,
  };
}

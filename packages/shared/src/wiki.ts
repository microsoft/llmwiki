import matter from 'gray-matter';
import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'node:fs/promises';
import { join, dirname, extname, relative, resolve } from 'node:path';
import { isNotFoundError } from './errors.js';
import { slugify } from './utils.js';
import { addEntry, escapeMarkdownLinkText, removeEntry } from './index-ops.js';
import type { IndexEntry } from './index-ops.js';
import { getBacklinks } from './backlinks.js';
import type { BacklinkResult } from './backlinks.js';

export interface WikiPageFrontmatter {
  type?: string;
  title?: string;
  tags?: string[];
  sources?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

export interface WikiPage {
  frontmatter: WikiPageFrontmatter;
  body: string;
}

export async function readPage(filePath: string): Promise<WikiPage> {
  const raw = await readFile(filePath, 'utf-8');
  const { data, content } = matter(raw);
  return {
    frontmatter: data as WikiPageFrontmatter,
    body: content.trim(),
  };
}

export async function writePage(filePath: string, page: WikiPage): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const output = matter.stringify(page.body, page.frontmatter);
  await writeFile(filePath, output, 'utf-8');
}

export async function listPages(wikiDir: string): Promise<string[]> {
  try {
    const entries = await readdir(wikiDir, { recursive: true });
    return entries
      .filter((entry) => typeof entry === 'string' && extname(entry) === '.md')
      .map((entry) => join(wikiDir, entry as string));
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

/**
 * Check whether a directory exists.
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

export interface PageLinkDetail {
  /** The display text of the markdown link */
  text: string;
  /** The link target (href) */
  target: string;
}

/**
 * Extract all internal markdown links (relative `.md` paths) from content,
 * returning both the display text and target for each link.
 */
export function getPageLinksDetailed(content: string): PageLinkDetail[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: PageLinkDetail[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    const text = match[1];
    const target = match[2];
    if (target.endsWith('.md') && !target.startsWith('http://') && !target.startsWith('https://')) {
      links.push({ text, target });
    }
  }
  return links;
}

export function getPageLinks(content: string): string[] {
  return getPageLinksDetailed(content).map((link) => link.target);
}

export interface CreatePageResult {
  path: string;
  indexEntry: IndexEntry;
}

/**
 * Create an entity page at wiki/entities/{slug}.md with proper frontmatter
 * and register it in the wiki index.
 */
export async function createEntityPage(
  wikiDir: string,
  name: string,
  content: string,
  tags: string[] = [],
): Promise<CreatePageResult> {
  const slug = slugify(name);
  const relPath = `entities/${slug}.md`;
  const fullPath = join(wikiDir, relPath);
  const now = new Date().toISOString();

  await writePage(fullPath, {
    frontmatter: {
      type: 'entity',
      title: name,
      tags,
      created: now,
    },
    body: content,
  });

  const indexEntry: IndexEntry = {
    path: relPath,
    title: name,
    summary: '',
    category: 'Entities',
    tags,
  };

  const indexPath = join(wikiDir, 'index.md');
  await addEntry(indexPath, indexEntry);

  return { path: relPath, indexEntry };
}

/**
 * Create a concept page at wiki/concepts/{slug}.md with proper frontmatter
 * and register it in the wiki index.
 */
export async function createConceptPage(
  wikiDir: string,
  name: string,
  content: string,
  tags: string[] = [],
): Promise<CreatePageResult> {
  const slug = slugify(name);
  const relPath = `concepts/${slug}.md`;
  const fullPath = join(wikiDir, relPath);
  const now = new Date().toISOString();

  await writePage(fullPath, {
    frontmatter: {
      type: 'concept',
      title: name,
      tags,
      created: now,
    },
    body: content,
  });

  const indexEntry: IndexEntry = {
    path: relPath,
    title: name,
    summary: '',
    category: 'Concepts',
    tags,
  };

  const indexPath = join(wikiDir, 'index.md');
  await addEntry(indexPath, indexEntry);

  return { path: relPath, indexEntry };
}

/**
 * Append "See also" crosslinks to a wiki page.
 * Validates all source and target pages exist, reads target titles from
 * frontmatter, and appends (or extends) a "## See also" section with
 * relative markdown links.  Duplicate links are silently skipped.
 */
export async function addCrosslinks(
  wikiDir: string,
  fromPage: string,
  toPages: string[],
): Promise<void> {
  if (toPages.length === 0) return;

  const fromFull = join(wikiDir, fromPage);

  // Validate fromPage exists
  try {
    await stat(fromFull);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(`Source page not found: ${fromPage}`);
    }
    throw err;
  }

  // Validate all toPages exist, collect missing
  const missing: string[] = [];
  for (const tp of toPages) {
    try {
      await stat(join(wikiDir, tp));
    } catch (err) {
      if (isNotFoundError(err)) {
        missing.push(tp);
      } else {
        throw err;
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Target pages not found: ${missing.join(', ')}`);
  }

  // Read the source page
  const page = await readPage(fromFull);

  // Build link entries for each target page
  const linkLines: string[] = [];
  for (const tp of toPages) {
    const toFull = join(wikiDir, tp);
    let title: string;
    try {
      const targetPage = await readPage(toFull);
      title =
        (targetPage.frontmatter.title as string) ||
        tp.replace(/\.md$/, '').split('/').pop()!;
    } catch {
      title = tp.replace(/\.md$/, '').split('/').pop()!;
    }
    const relLink = relative(dirname(fromFull), toFull).replace(/\\/g, '/');
    linkLines.push(`- [${escapeMarkdownLinkText(title)}](${relLink})`);
  }

  // Check if "## See also" section exists
  const seeAlsoHeader = '## See also';
  const seeAlsoIndex = page.body.indexOf(seeAlsoHeader);

  let newBody: string;
  if (seeAlsoIndex !== -1) {
    // Find the end of the See also section (next ## heading or end of body)
    const afterHeader = seeAlsoIndex + seeAlsoHeader.length;
    const nextHeadingMatch = page.body.slice(afterHeader).search(/\n## /);
    const sectionEnd =
      nextHeadingMatch !== -1 ? afterHeader + nextHeadingMatch : page.body.length;

    // Get existing links to avoid duplicates
    const existingSection = page.body.slice(afterHeader, sectionEnd);
    const existingLinks = new Set(
      existingSection
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- [')),
    );

    const newLinks = linkLines.filter((l) => !existingLinks.has(l));
    if (newLinks.length === 0) return;

    // Insert new links at the end of the existing section
    const before = page.body.slice(0, sectionEnd).trimEnd();
    const after = page.body.slice(sectionEnd);
    newBody = before + '\n' + newLinks.join('\n') + after;
  } else {
    newBody =
      page.body.trimEnd() + '\n\n' + seeAlsoHeader + '\n\n' + linkLines.join('\n');
  }

  await writePage(fromFull, {
    frontmatter: page.frontmatter,
    body: newBody,
  });
}

export interface DeleteResult {
  /** The relative path of the deleted page */
  deletedPath: string;
  /** Whether the file was successfully deleted */
  deleted: boolean;
  /** Backlink warnings - pages that still link to the deleted page */
  backlinkWarnings: BacklinkResult[];
}

/**
 * Delete a wiki page by relative path.
 * Validates the page exists, computes backlink warnings, removes the index
 * entry, then deletes the file from disk.
 *
 * Security: validates pagePath stays within wikiDir (no path traversal).
 * Order: index entry removed FIRST, then file deleted (safer to have orphan
 * file than orphan index entry).
 */
export async function deletePage(
  wikiDir: string,
  pagePath: string,
): Promise<DeleteResult> {
  // 1. Path traversal validation
  const resolvedBase = resolve(wikiDir).replace(/\\/g, '/');
  const resolvedFull = resolve(wikiDir, pagePath).replace(/\\/g, '/');
  if (!resolvedFull.startsWith(resolvedBase + '/') && resolvedFull !== resolvedBase) {
    throw new Error('Path traversal detected — pagePath must stay within wikiDir');
  }

  // 2. Validate page exists
  const fullPath = join(wikiDir, pagePath);
  try {
    await stat(fullPath);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(`Page not found: ${pagePath}`);
    }
    throw err;
  }

  // 3. Compute backlinks before deletion
  const backlinkWarnings = await getBacklinks(wikiDir, pagePath);

  // 4. Remove index entry FIRST (safer order)
  const indexPath = join(wikiDir, 'index.md');
  await removeEntry(indexPath, pagePath);

  // 5. Delete the file from disk
  await unlink(fullPath);

  return {
    deletedPath: pagePath,
    deleted: true,
    backlinkWarnings,
  };
}

import matter from 'gray-matter';
import { readFile, writeFile, readdir, stat, mkdir, unlink, realpath } from 'node:fs/promises';
import { join, dirname, extname, relative, resolve, basename, isAbsolute, sep } from 'node:path';
import { isNotFoundError } from './errors.js';
import { withWikiLock } from './lock.js';
import { slugify } from './utils.js';
import { escapeMarkdownLinkText, readIndex, removeEntry, upsertEntry, writeIndex } from './index-ops.js';
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
  // Passing options bypasses gray-matter's content-keyed cache, which hands
  // out shared `data` objects: a caller mutating one page's frontmatter would
  // otherwise change what later reads of identical content return.
  const { data, content } = matter(raw, {});
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

  return withWikiLock(wikiDir, async () => {
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
    await upsertEntry(indexPath, indexEntry);

    return { path: relPath, indexEntry };
  });
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

  return withWikiLock(wikiDir, async () => {
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
    await upsertEntry(indexPath, indexEntry);

    return { path: relPath, indexEntry };
  });
}

export interface UpsertDerivedPageResult extends CreatePageResult {
  /** False when an existing page was extended instead. */
  created: boolean;
}

/**
 * Create an entity or concept page derived from a source summary page, or —
 * if a page with the same slug exists — extend it instead of overwriting it:
 * the content is added before any "## See also" section (unless already
 * present), tags are combined, and `sourcePage` is added to `sources` when the
 * page already lists sources. New pages record `sources: [sourcePage]`.
 *
 * The read, merge and write happen under the wiki lock, so concurrent ingests
 * (in this process or another one) extend the page one after the other
 * instead of overwriting each other's content and sources.
 */
export async function upsertDerivedPage(
  wikiDir: string,
  kind: 'entity' | 'concept',
  name: string,
  content: string,
  tags: string[] = [],
  sourcePage?: string,
): Promise<UpsertDerivedPageResult> {
  const relPath = `${kind === 'entity' ? 'entities' : 'concepts'}/${slugify(name)}.md`;
  const fullPath = join(wikiDir, relPath);

  return withWikiLock(wikiDir, async () => {
    let existing: WikiPage | undefined;
    try {
      existing = await readPage(fullPath);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }

    if (!existing) {
      const result =
        kind === 'entity'
          ? await createEntityPage(wikiDir, name, content, tags)
          : await createConceptPage(wikiDir, name, content, tags);
      if (sourcePage) {
        const page = await readPage(fullPath);
        page.frontmatter.sources = [sourcePage];
        await writePage(fullPath, page);
      }
      return { ...result, created: true };
    }

    const frontmatter: WikiPageFrontmatter = { ...existing.frontmatter };
    const existingTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    frontmatter.tags = [...new Set([...existingTags, ...tags])];
    const sources = frontmatter.sources;
    if (sourcePage && Array.isArray(sources) && sources.length > 0 && !sources.includes(sourcePage)) {
      frontmatter.sources = [...sources, sourcePage];
    }

    let body = existing.body;
    const addition = content.trim();
    if (addition && !body.includes(addition)) {
      const seeAlso = body.search(/^## See also\b/m);
      body =
        seeAlso >= 0
          ? `${body.slice(0, seeAlso).trimEnd()}\n\n${addition}\n\n${body.slice(seeAlso)}`
          : `${body.trimEnd()}\n\n${addition}`;
    }
    await writePage(fullPath, { frontmatter, body });

    const indexEntry: IndexEntry = {
      path: relPath,
      title: (frontmatter.title as string | undefined) || name,
      summary: '',
      category: kind === 'entity' ? 'Entities' : 'Concepts',
      tags: frontmatter.tags,
    };
    await upsertEntry(join(wikiDir, 'index.md'), indexEntry);

    return { path: relPath, indexEntry, created: false };
  });
}

/**
 * Append "See also" crosslinks to a wiki page.
 * Validates all source and target pages exist, reads target titles from
 * frontmatter, and appends (or extends) a "## See also" section with
 * relative markdown links.  Duplicate links are silently skipped.
 * Runs under the wiki lock, like other page updates.
 */
export async function addCrosslinks(
  wikiDir: string,
  fromPage: string,
  toPages: string[],
): Promise<void> {
  if (toPages.length === 0) return;
  await withWikiLock(wikiDir, () => appendCrosslinks(wikiDir, fromPage, toPages));
}

async function appendCrosslinks(
  wikiDir: string,
  fromPage: string,
  toPages: string[],
): Promise<void> {
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
 * True for the wiki's own index.md and log.md (wiki-relative path), in any
 * letter case: on case-insensitive file systems `Index.md` is the index.
 */
export function isSpecialWikiFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'index.md' || normalized === 'log.md';
}

/** True when `target` is strictly inside `base` (both absolute). */
function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve the file that `deletePage` may remove. The path must stay inside
 * the wiki both as written and after resolving symlinked folders (so a link
 * such as wiki/linked -> ../raw can't delete a raw source), and must not be
 * index.md or log.md at either location. Returns the resolved path.
 */
async function resolveDeletablePage(wikiDir: string, pagePath: string): Promise<string> {
  const base = resolve(wikiDir);
  const full = resolve(base, pagePath);
  if (!isInside(base, full)) {
    throw new Error('Path traversal detected — pagePath must stay within wikiDir');
  }

  let realBase: string;
  let realParent: string;
  try {
    realBase = await realpath(base);
    realParent = await realpath(dirname(full));
  } catch (err) {
    if (isNotFoundError(err)) throw new Error(`Page not found: ${pagePath}`);
    throw err;
  }
  const realFull = join(realParent, basename(full));
  if (!isInside(realBase, realFull)) {
    throw new Error('Path traversal detected — pagePath must stay within wikiDir');
  }

  for (const rel of [relative(base, full), relative(realBase, realFull)]) {
    if (isSpecialWikiFile(rel)) {
      throw new Error(`'${rel.replace(/\\/g, '/')}' is a special wiki file and cannot be deleted`);
    }
  }
  return realFull;
}

/**
 * Delete a wiki page by relative path.
 * Validates the page exists, computes backlink warnings, removes the index
 * entry, then deletes the file from disk.
 *
 * Security: pagePath must stay within wikiDir, also after resolving symlinked
 * folders, and can't be index.md or log.md (in any letter case).
 * Order: index entry removed FIRST, then file deleted (safer to have orphan
 * file than orphan index entry).
 */
export async function deletePage(
  wikiDir: string,
  pagePath: string,
): Promise<DeleteResult> {
  // 1. Path traversal and special-file validation
  const fullPath = await resolveDeletablePage(wikiDir, pagePath);

  return withWikiLock(wikiDir, async () => {
    // 2. Validate page exists
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
  });
}

export interface RenameResult {
  /** Whether the rename was successful */
  renamed: boolean;
  /** The old relative path */
  oldPath: string;
  /** The new relative path */
  newPath: string;
  /** Number of links that were rewritten across the wiki */
  rewrittenLinks: number;
  /** Relative paths of pages whose links were rewritten */
  affectedPages: string[];
}

/**
 * Rename (move) a wiki page from oldPath to newPath.
 * Rewrites backlinks across the wiki, updates the index entry, and
 * optionally updates a path-derived frontmatter title. Runs under the wiki
 * lock, like other page updates.
 *
 * Security: validates both paths stay within wikiDir (no path traversal).
 */
export async function renamePage(
  wikiDir: string,
  oldPath: string,
  newPath: string,
): Promise<RenameResult> {
  return withWikiLock(wikiDir, () => movePage(wikiDir, oldPath, newPath));
}

async function movePage(
  wikiDir: string,
  oldPath: string,
  newPath: string,
): Promise<RenameResult> {
  // 1. Path traversal guard on BOTH paths
  const resolvedBase = resolve(wikiDir).replace(/\\/g, '/');
  const resolvedOld = resolve(wikiDir, oldPath).replace(/\\/g, '/');
  if (!resolvedOld.startsWith(resolvedBase + '/') && resolvedOld !== resolvedBase) {
    throw new Error('Path traversal detected — oldPath must stay within wikiDir');
  }
  const resolvedNew = resolve(wikiDir, newPath).replace(/\\/g, '/');
  if (!resolvedNew.startsWith(resolvedBase + '/') && resolvedNew !== resolvedBase) {
    throw new Error('Path traversal detected — newPath must stay within wikiDir');
  }

  // 2. Validate old page exists
  const oldFull = join(wikiDir, oldPath);
  try {
    await stat(oldFull);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new Error(`Page not found: ${oldPath}`);
    }
    throw err;
  }

  // 3. Validate new path does NOT exist
  const newFull = join(wikiDir, newPath);
  try {
    await stat(newFull);
    throw new Error(`Target path already exists: ${newPath}`);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Good — file doesn't exist
  }

  // 4. Read old page content
  const page = await readPage(oldFull);

  // 5. Update frontmatter title if it was path-derived
  const oldStem = oldPath.replace(/\.md$/, '').split('/').pop()!;
  const newStem = newPath.replace(/\.md$/, '').split('/').pop()!;
  if (page.frontmatter.title) {
    const normalizedTitle = page.frontmatter.title.toLowerCase().replace(/[\s_-]+/g, '-');
    const normalizedOldStem = oldStem.toLowerCase().replace(/[\s_-]+/g, '-');
    if (normalizedTitle === normalizedOldStem) {
      page.frontmatter.title = newStem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // 6. Create parent directories + write new file
  await writePage(newFull, page);

  // 7. Scan ALL wiki pages for links to oldPath and rewrite them
  const allPages = await listPages(wikiDir);
  const normOld = oldPath.replace(/\\/g, '/');
  const affectedPages: string[] = [];
  let rewrittenLinks = 0;

  for (const absPagePath of allPages) {
    // Skip the old file itself (it's about to be deleted)
    if (resolve(absPagePath).replace(/\\/g, '/') === resolvedOld) continue;
    // Skip the new file (just written)
    if (resolve(absPagePath).replace(/\\/g, '/') === resolve(newFull).replace(/\\/g, '/')) continue;

    const sourcePage = await readPage(absPagePath);
    const links = getPageLinksDetailed(sourcePage.body);
    let modified = false;
    let updatedBody = sourcePage.body;

    for (const { text, target } of links) {
      const sourceDir = dirname(absPagePath);
      const resolvedAbsolute = join(sourceDir, target);
      const resolvedRelative = relative(wikiDir, resolvedAbsolute).replace(/\\/g, '/');

      if (resolvedRelative === normOld) {
        // Compute new relative link from this source page to new location
        const newRelLink = relative(dirname(absPagePath), newFull).replace(/\\/g, '/');
        // Replace the exact link in body
        const oldLink = `[${text}](${target})`;
        const newLink = `[${text}](${newRelLink})`;
        updatedBody = updatedBody.replace(oldLink, newLink);
        modified = true;
        rewrittenLinks++;
      }
    }

    if (modified) {
      await writePage(absPagePath, { frontmatter: sourcePage.frontmatter, body: updatedBody });
      const relSourcePath = relative(wikiDir, absPagePath).replace(/\\/g, '/');
      affectedPages.push(relSourcePath);
    }
  }

  // 8. Update index entry
  const indexPath = join(wikiDir, 'index.md');
  const entries = await readIndex(indexPath);
  const entryIdx = entries.findIndex((e) => e.path === oldPath);
  if (entryIdx >= 0) {
    entries[entryIdx].path = newPath;
    if (page.frontmatter.title) {
      entries[entryIdx].title = page.frontmatter.title;
    }
    await writeIndex(indexPath, entries);
  }

  // 9. Delete old file
  await unlink(oldFull);

  // 10. Return result
  return { renamed: true, oldPath, newPath, rewrittenLinks, affectedPages };
}

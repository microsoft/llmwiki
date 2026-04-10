import { basename, dirname, join, relative } from 'node:path';
import { listPages, readPage } from './wiki.js';

export interface BacklinkResult {
  /** Absolute path of the page containing the backlink */
  sourcePage: string;
  /** Title from the source page's frontmatter (or filename if missing) */
  sourceTitle: string;
  /** The link text used in the markdown link */
  linkText: string;
}

/**
 * Find all wiki pages that contain links pointing to `targetPage`.
 *
 * `targetPage` should be a relative path (e.g. "concepts/ai.md") as it
 * appears in markdown link targets.
 *
 * Iterates all pages via `listPages()`, extracts markdown links,
 * and resolves each link relative to the source page's directory to compare
 * against the target.
 */
export async function getBacklinks(
  wikiDir: string,
  targetPage: string,
): Promise<BacklinkResult[]> {
  const pages = await listPages(wikiDir);
  const results: BacklinkResult[] = [];

  // Normalise target to forward-slash relative path
  const normTarget = targetPage.replace(/\\/g, '/');

  for (const pagePath of pages) {
    const page = await readPage(pagePath);
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(page.body)) !== null) {
      const linkText = match[1];
      const linkTarget = match[2];

      // Skip external and non-.md links (same filter as getPageLinks)
      if (
        !linkTarget.endsWith('.md') ||
        linkTarget.startsWith('http://') ||
        linkTarget.startsWith('https://')
      ) {
        continue;
      }

      // Resolve the link relative to the source page's directory
      const sourceDir = dirname(pagePath);
      const resolvedAbsolute = join(sourceDir, linkTarget);
      const resolvedRelative = relative(wikiDir, resolvedAbsolute).replace(/\\/g, '/');

      if (resolvedRelative === normTarget) {
        results.push({
          sourcePage: pagePath,
          sourceTitle: page.frontmatter.title ?? basename(pagePath, '.md'),
          linkText,
        });
      }
    }
  }

  return results;
}

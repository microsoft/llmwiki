import { basename, dirname, join, relative } from 'node:path';
import { listPages, readPage, getPageLinksDetailed } from './wiki.js';

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
    const links = getPageLinksDetailed(page.body);

    for (const { text, target } of links) {
      // Resolve the link relative to the source page's directory
      const sourceDir = dirname(pagePath);
      const resolvedAbsolute = join(sourceDir, target);
      const resolvedRelative = relative(wikiDir, resolvedAbsolute).replace(/\\/g, '/');

      if (resolvedRelative === normTarget) {
        results.push({
          sourcePage: pagePath,
          sourceTitle: page.frontmatter.title ?? basename(pagePath, '.md'),
          linkText: text,
        });
      }
    }
  }

  return results;
}

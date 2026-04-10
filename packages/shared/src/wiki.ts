import matter from 'gray-matter';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { isNotFoundError } from './errors.js';

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

export function getPageLinks(content: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[2];
    // Only internal links (relative paths ending in .md), not external URLs
    if (target.endsWith('.md') && !target.startsWith('http://') && !target.startsWith('https://')) {
      links.push(target);
    }
  }
  return links;
}

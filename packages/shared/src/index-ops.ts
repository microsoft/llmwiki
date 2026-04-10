import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isNotFoundError } from './errors.js';

export interface IndexEntry {
  path: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
}

export interface FindOptions {
  title?: string;
  tags?: string[];
}

/**
 * Parse a markdown index entry line into its components.
 * Format: `- [Title](path) — Summary text #tag1 #tag2`
 */
function parseEntryLine(line: string, category: string): IndexEntry | null {
  const trimmed = line.trim();
  const entryMatch = trimmed.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)(.*)$/);
  if (!entryMatch) {
    return null;
  }

  const title = entryMatch[1];
  const path = entryMatch[2];
  const rest = entryMatch[3].trim();

  let summaryText = '';
  const tags: string[] = [];

  if (rest) {
    // Strip leading em-dash, en-dash, or hyphen separator
    const dashMatch = rest.match(/^[—–-]\s*(.*)$/);
    const afterDash = dashMatch ? dashMatch[1] : rest;

    // Extract hashtags
    const tagRegex = /#([\w-]+)/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(afterDash)) !== null) {
      tags.push(tagMatch[1]);
    }

    // Summary is everything except tags, trimmed
    summaryText = afterDash.replace(/#[\w-]+/g, '').trim();
  }

  return { path, title, summary: summaryText, category, tags };
}

/**
 * Format a single index entry as a markdown list item.
 */
function formatEntryLine(entry: IndexEntry): string {
  let line = `- [${entry.title}](${entry.path})`;
  const parts: string[] = [];
  if (entry.summary) {
    parts.push(entry.summary);
  }
  if (entry.tags.length > 0) {
    parts.push(entry.tags.map((t) => `#${t}`).join(' '));
  }
  if (parts.length > 0) {
    line += ` — ${parts.join(' ')}`;
  }
  return line;
}

/**
 * Parse a categorized markdown index file into an array of IndexEntry objects.
 * Returns an empty array for missing or empty files.
 */
export async function readIndex(filePath: string): Promise<IndexEntry[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }

  const entries: IndexEntry[] = [];
  let currentCategory = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Detect H2 category heading
    const categoryMatch = trimmed.match(/^##\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    // Only parse entries when inside a category
    if (currentCategory) {
      const entry = parseEntryLine(trimmed, currentCategory);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Serialize an array of IndexEntry objects back to a categorized markdown file.
 * Entries are grouped by category in the order they first appear.
 */
export async function writeIndex(
  filePath: string,
  entries: IndexEntry[],
): Promise<void> {
  // Group entries by category, preserving insertion order
  const categories = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    if (!categories.has(entry.category)) {
      categories.set(entry.category, []);
    }
    categories.get(entry.category)!.push(entry);
  }

  let output = '# Wiki Index\n';

  for (const [category, categoryEntries] of categories) {
    output += `\n## ${category}\n\n`;
    for (const entry of categoryEntries) {
      output += formatEntryLine(entry) + '\n';
    }
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, output, 'utf-8');
}

/**
 * Add an entry to the index file under the appropriate category.
 * Creates the category if it does not already exist.
 */
export async function addEntry(
  filePath: string,
  entry: IndexEntry,
): Promise<void> {
  const entries = await readIndex(filePath);
  entries.push(entry);
  await writeIndex(filePath, entries);
}

/**
 * Remove an entry from the index file by its path.
 * If the path does not exist, the file is left unchanged.
 */
export async function removeEntry(
  filePath: string,
  path: string,
): Promise<void> {
  const entries = await readIndex(filePath);
  const filtered = entries.filter((e) => e.path !== path);
  await writeIndex(filePath, filtered);
}

/**
 * Update metadata fields (summary, tags, category) for an existing index entry.
 * Returns `true` if the entry was found and updated, `false` if not found.
 */
export async function updateIndexEntry(
  filePath: string,
  pagePath: string,
  updates: Partial<Omit<IndexEntry, 'path'>>,
): Promise<boolean> {
  const entries = await readIndex(filePath);
  const idx = entries.findIndex((e) => e.path === pagePath);
  if (idx < 0) return false;

  const entry = entries[idx];
  if (updates.title !== undefined) entry.title = updates.title;
  if (updates.summary !== undefined) entry.summary = updates.summary;
  if (updates.tags !== undefined) entry.tags = updates.tags;
  if (updates.category !== undefined) entry.category = updates.category;

  await writeIndex(filePath, entries);
  return true;
}

/**
 * Search entries by title substring and/or tags.
 * Title matching is case-insensitive. Tag matching requires at least
 * one of the provided tags to be present on the entry.
 */
export function findEntries(
  entries: IndexEntry[],
  options: FindOptions,
): IndexEntry[] {
  return entries.filter((entry) => {
    if (options.title) {
      if (!entry.title.toLowerCase().includes(options.title.toLowerCase())) {
        return false;
      }
    }
    if (options.tags && options.tags.length > 0) {
      if (!options.tags.some((tag) => entry.tags.includes(tag))) {
        return false;
      }
    }
    return true;
  });
}


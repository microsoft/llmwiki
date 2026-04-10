import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export interface SourceFile {
  /** File name including extension */
  name: string;
  /** Relative path from rawDir */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last modified date as ISO string */
  modified: string;
  /** File extension including the dot (e.g. ".txt") */
  extension: string;
}

/**
 * List all files in a raw sources directory with metadata.
 * Returns an empty array if the directory does not exist.
 */
export async function listSources(rawDir: string): Promise<SourceFile[]> {
  let entries: string[];
  try {
    entries = await readdir(rawDir, { recursive: true }) as unknown as string[];
  } catch {
    return [];
  }

  const results: SourceFile[] = [];

  for (const entry of entries) {
    const fullPath = join(rawDir, entry);
    try {
      const s = await stat(fullPath);
      if (s.isFile()) {
        results.push({
          name: basename(entry),
          path: entry.replace(/\\/g, '/'),
          size: s.size,
          modified: s.mtime.toISOString(),
          extension: extname(entry),
        });
      }
    } catch {
      // Skip entries that can't be stat'd (e.g. broken symlinks)
    }
  }

  return results;
}

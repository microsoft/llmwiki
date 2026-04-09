import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LogEntry {
  date: string;
  verb: string;
  subject: string;
  details: string;
}

/**
 * Append a new entry to a log file.
 * Auto-generates the date as YYYY-MM-DD if not provided.
 * Creates parent directories and the file if they do not exist.
 */
export async function appendEntry(
  logPath: string,
  entry: Omit<LogEntry, 'date'> & { date?: string },
): Promise<void> {
  const date = entry.date ?? new Date().toISOString().slice(0, 10);
  const formatted = `## [${date}] ${entry.verb} | ${entry.subject}\n\n${entry.details}\n\n`;

  let existing = '';
  try {
    existing = await readFile(logPath, 'utf-8');
  } catch {
    // File does not exist yet — will be created
  }

  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, existing + formatted, 'utf-8');
}

/**
 * Parse a markdown log file into an array of LogEntry objects.
 * Returns an empty array for missing or empty files.
 */
export async function readLog(logPath: string): Promise<LogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch {
    return [];
  }

  if (!content.trim()) {
    return [];
  }

  const entries: LogEntry[] = [];
  const headerRegex = /^## \[(\d{4}-\d{2}-\d{2})\] (\S+) \| (.+)$/;
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  let currentEntry: { date: string; verb: string; subject: string } | null =
    null;
  let detailLines: string[] = [];

  for (const line of lines) {
    const match = line.match(headerRegex);
    if (match) {
      // Flush previous entry
      if (currentEntry) {
        entries.push({
          ...currentEntry,
          details: detailLines.join('\n').trim(),
        });
      }
      currentEntry = {
        date: match[1],
        verb: match[2],
        subject: match[3].trim(),
      };
      detailLines = [];
    } else if (currentEntry) {
      detailLines.push(line);
    }
  }

  // Flush last entry
  if (currentEntry) {
    entries.push({
      ...currentEntry,
      details: detailLines.join('\n').trim(),
    });
  }

  return entries;
}

/**
 * Return the last N entries from a log file.
 * Entries are returned in file order (oldest first among the last N).
 */
export async function getRecentEntries(
  logPath: string,
  count: number,
): Promise<LogEntry[]> {
  const entries = await readLog(logPath);
  if (count >= entries.length) {
    return entries;
  }
  return entries.slice(-count);
}

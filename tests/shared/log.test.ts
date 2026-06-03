import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLog, appendEntry, getRecentEntries } from '../../packages/core/src/log.js';
import type { LogEntry } from '../../packages/core/src/log.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures', 'log');

describe('readLog', () => {
  it('should parse a log with multiple entries', async () => {
    const entries = await readLog(join(fixturesDir, 'valid-log.md'));
    expect(entries).toHaveLength(4);

    expect(entries[0].date).toBe('2026-01-15');
    expect(entries[0].verb).toBe('created');
    expect(entries[0].subject).toBe('Alan Turing');
    expect(entries[0].details).toBe(
      'Added initial page for Alan Turing with biography and contributions.',
    );

    expect(entries[1].date).toBe('2026-01-16');
    expect(entries[1].verb).toBe('updated');
    expect(entries[1].subject).toBe('Neural Networks');
    expect(entries[1].details).toBe(
      'Expanded section on backpropagation and added references.',
    );

    expect(entries[2].date).toBe('2026-02-01');
    expect(entries[2].verb).toBe('created');
    expect(entries[2].subject).toBe('Claude Shannon');
    expect(entries[2].details).toBe(
      'Added page for Claude Shannon, father of information theory.',
    );

    expect(entries[3].date).toBe('2026-02-15');
    expect(entries[3].verb).toBe('linked');
    expect(entries[3].subject).toBe('Alan Turing');
    expect(entries[3].details).toBe(
      'Added cross-references to Claude Shannon and Neural Networks pages.',
    );
  });

  it('should parse a single-entry log', async () => {
    const entries = await readLog(join(fixturesDir, 'single-entry.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-03-01');
    expect(entries[0].verb).toBe('created');
    expect(entries[0].subject).toBe('Test Page');
    expect(entries[0].details).toBe(
      'This is a single entry log for testing.',
    );
  });

  it('should return empty array for empty file', async () => {
    const entries = await readLog(join(fixturesDir, 'empty-log.md'));
    expect(entries).toEqual([]);
  });

  it('should return empty array for non-existent file', async () => {
    const entries = await readLog(join(fixturesDir, 'does-not-exist.md'));
    expect(entries).toEqual([]);
  });
});

describe('appendEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'log-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should append an entry to an existing log', async () => {
    const filePath = join(tmpDir, 'log.md');
    const initialContent =
      '## [2026-01-01] created | First Page\n\nInitial content.\n\n';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, initialContent, 'utf-8');

    await appendEntry(filePath, {
      date: '2026-01-02',
      verb: 'updated',
      subject: 'First Page',
      details: 'Updated content.',
    });

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## [2026-01-01] created | First Page');
    expect(content).toContain('Initial content.');
    expect(content).toContain('## [2026-01-02] updated | First Page');
    expect(content).toContain('Updated content.');
  });

  it('should create log file if it does not exist', async () => {
    const filePath = join(tmpDir, 'new-log.md');

    await appendEntry(filePath, {
      date: '2026-05-01',
      verb: 'created',
      subject: 'New Page',
      details: 'Brand new page.',
    });

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## [2026-05-01] created | New Page');
    expect(content).toContain('Brand new page.');

    const entries = await readLog(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].subject).toBe('New Page');
  });

  it('should create parent directories if needed', async () => {
    const filePath = join(tmpDir, 'sub', 'dir', 'log.md');

    await appendEntry(filePath, {
      date: '2026-06-01',
      verb: 'created',
      subject: 'Deep Page',
      details: 'Nested log entry.',
    });

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## [2026-06-01] created | Deep Page');
    expect(content).toContain('Nested log entry.');
  });

  it('should auto-generate date if not provided', async () => {
    const filePath = join(tmpDir, 'auto-date.md');

    await appendEntry(filePath, {
      verb: 'created',
      subject: 'Auto Date Page',
      details: 'Should have today date.',
    });

    const entries = await readLog(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entries[0].verb).toBe('created');
    expect(entries[0].subject).toBe('Auto Date Page');
  });

  it('should use provided date when given', async () => {
    const filePath = join(tmpDir, 'explicit-date.md');

    await appendEntry(filePath, {
      date: '2026-06-15',
      verb: 'updated',
      subject: 'Dated Page',
      details: 'Explicit date entry.',
    });

    const entries = await readLog(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-06-15');
  });

  it('should handle empty details', async () => {
    const filePath = join(tmpDir, 'empty-details.md');

    await appendEntry(filePath, {
      date: '2026-07-01',
      verb: 'created',
      subject: 'Empty Details',
      details: '',
    });

    const entries = await readLog(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toBe('');
    expect(entries[0].verb).toBe('created');
    expect(entries[0].subject).toBe('Empty Details');
  });
});

describe('getRecentEntries', () => {
  it('should return last N entries', async () => {
    const entries = await getRecentEntries(
      join(fixturesDir, 'valid-log.md'),
      2,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe('2026-02-01');
    expect(entries[0].subject).toBe('Claude Shannon');
    expect(entries[1].date).toBe('2026-02-15');
    expect(entries[1].subject).toBe('Alan Turing');
  });

  it('should return all entries when count exceeds total', async () => {
    const entries = await getRecentEntries(
      join(fixturesDir, 'valid-log.md'),
      10,
    );
    expect(entries).toHaveLength(4);
    expect(entries[0].date).toBe('2026-01-15');
    expect(entries[3].date).toBe('2026-02-15');
  });

  it('should return empty array for missing file', async () => {
    const entries = await getRecentEntries(
      join(fixturesDir, 'does-not-exist.md'),
      5,
    );
    expect(entries).toEqual([]);
  });

  it('should return single entry from single-entry log', async () => {
    const entries = await getRecentEntries(
      join(fixturesDir, 'single-entry.md'),
      1,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-03-01');
    expect(entries[0].verb).toBe('created');
    expect(entries[0].subject).toBe('Test Page');
  });
});

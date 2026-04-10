import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePage } from '../../../packages/shared/src/wiki.js';
import { writeIndex } from '../../../packages/shared/src/index-ops.js';
import { createProgram } from '../../../packages/cli/src/cli.js';
import type { PageInfo, SourceFile, IndexEntry } from '../../../packages/cli/src/commands/list.js';

/* ------------------------------------------------------------------ */
/*  Helper: capture console.log output during CLI execution           */
/* ------------------------------------------------------------------ */

async function runCli(args: string[]): Promise<string[]> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(' '));

  try {
    const program = createProgram();
    await program.parseAsync(['node', 'plaid', ...args]);
    return logs;
  } finally {
    console.log = origLog;
  }
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

async function setupWiki(tmpDir: string): Promise<void> {
  await mkdir(join(tmpDir, 'raw'), { recursive: true });
  await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
  await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

  // Wiki pages
  await writePage(join(tmpDir, 'wiki', 'entities', 'alice.md'), {
    frontmatter: { type: 'entity', title: 'Alice', tags: ['person', 'main'] },
    body: 'Alice is the protagonist.',
  });
  await writePage(join(tmpDir, 'wiki', 'concepts', 'trust.md'), {
    frontmatter: { type: 'concept', title: 'Trust', tags: ['abstract'] },
    body: 'Trust is fundamental.',
  });

  // Source files
  await writeFile(join(tmpDir, 'raw', 'doc1.txt'), 'Source document one');
  await writeFile(join(tmpDir, 'raw', 'notes.md'), '# Notes\n\nSome notes.');

  // Index
  await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
    {
      path: 'entities/alice.md',
      title: 'Alice',
      summary: 'The protagonist',
      category: 'Entities',
      tags: ['person'],
    },
    {
      path: 'concepts/trust.md',
      title: 'Trust',
      summary: 'A core concept',
      category: 'Concepts',
      tags: ['abstract'],
    },
  ]);
}

/* ================================================================== */
/*  Tests                                                             */
/* ================================================================== */

describe('list command registration', () => {
  it('should register list command under wiki', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const list = wiki!.commands.find((cmd) => cmd.name() === 'list');
    expect(list).toBeDefined();
    expect(list!.description()).toBe('List wiki pages, source files, or index entries');
  });

  it('should have --path option', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    const list = wiki!.commands.find((cmd) => cmd.name() === 'list');
    const pathOption = list!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  list pages                                                        */
/* ------------------------------------------------------------------ */

describe('list pages', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'list-pages-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should show empty message for missing wiki', async () => {
    const logs = await runCli(['wiki', 'list', 'pages', '--path', tmpDir]);
    expect(logs.join('\n')).toContain('No wiki pages found.');
  });

  it('should list pages in human-readable table', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', 'list', 'pages', '--path', tmpDir]);
    const output = logs.join('\n');

    expect(output).toContain('Wiki Pages');
    expect(output).toContain('Alice');
    expect(output).toContain('Trust');
    expect(output).toContain('entity');
    expect(output).toContain('concept');
    expect(output).toContain('entities/alice.md');
    expect(output).toContain('concepts/trust.md');
  });

  it('should list pages in JSON format', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', '--json', 'list', 'pages', '--path', tmpDir]);

    expect(logs).toHaveLength(1);
    const pages: PageInfo[] = JSON.parse(logs[0]);
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBe(2);

    const alice = pages.find((p) => p.title === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.type).toBe('entity');
    expect(alice!.tags).toContain('person');
    expect(alice!.path).toBe('entities/alice.md');

    const trust = pages.find((p) => p.title === 'Trust');
    expect(trust).toBeDefined();
    expect(trust!.type).toBe('concept');
    expect(trust!.tags).toContain('abstract');
  });

  it('should return empty JSON array for missing wiki', async () => {
    const logs = await runCli(['wiki', '--json', 'list', 'pages', '--path', tmpDir]);
    expect(logs).toHaveLength(1);
    const pages: PageInfo[] = JSON.parse(logs[0]);
    expect(pages).toEqual([]);
  });

  it('should exclude index.md and log.md from pages', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', '--json', 'list', 'pages', '--path', tmpDir]);
    const pages: PageInfo[] = JSON.parse(logs[0]);
    const paths = pages.map((p) => p.path);
    expect(paths).not.toContain('index.md');
    expect(paths).not.toContain('log.md');
  });
});

/* ------------------------------------------------------------------ */
/*  list sources                                                      */
/* ------------------------------------------------------------------ */

describe('list sources', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'list-sources-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should show empty message for missing raw/', async () => {
    const logs = await runCli(['wiki', 'list', 'sources', '--path', tmpDir]);
    expect(logs.join('\n')).toContain('No source files found.');
  });

  it('should list sources in human-readable table', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', 'list', 'sources', '--path', tmpDir]);
    const output = logs.join('\n');

    expect(output).toContain('Source Files');
    expect(output).toContain('doc1.txt');
    expect(output).toContain('notes.md');
    expect(output).toContain('.txt');
    expect(output).toContain('.md');
  });

  it('should list sources in JSON format', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', '--json', 'list', 'sources', '--path', tmpDir]);

    expect(logs).toHaveLength(1);
    const sources: SourceFile[] = JSON.parse(logs[0]);
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBe(2);

    const doc1 = sources.find((s) => s.name === 'doc1.txt');
    expect(doc1).toBeDefined();
    expect(doc1!.extension).toBe('.txt');
    expect(doc1!.size).toBeGreaterThan(0);
    expect(doc1!.modified).toBeTruthy();

    const notes = sources.find((s) => s.name === 'notes.md');
    expect(notes).toBeDefined();
    expect(notes!.extension).toBe('.md');
  });

  it('should return empty JSON array for missing raw/', async () => {
    const logs = await runCli(['wiki', '--json', 'list', 'sources', '--path', tmpDir]);
    expect(logs).toHaveLength(1);
    const sources: SourceFile[] = JSON.parse(logs[0]);
    expect(sources).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  list entries                                                      */
/* ------------------------------------------------------------------ */

describe('list entries', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'list-entries-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should show empty message for missing index', async () => {
    const logs = await runCli(['wiki', 'list', 'entries', '--path', tmpDir]);
    expect(logs.join('\n')).toContain('No index entries found.');
  });

  it('should list entries in human-readable table', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', 'list', 'entries', '--path', tmpDir]);
    const output = logs.join('\n');

    expect(output).toContain('Index Entries');
    expect(output).toContain('Alice');
    expect(output).toContain('Trust');
    expect(output).toContain('Entities');
    expect(output).toContain('Concepts');
    expect(output).toContain('entities/alice.md');
    expect(output).toContain('concepts/trust.md');
  });

  it('should list entries in JSON format', async () => {
    await setupWiki(tmpDir);
    const logs = await runCli(['wiki', '--json', 'list', 'entries', '--path', tmpDir]);

    expect(logs).toHaveLength(1);
    const entries: IndexEntry[] = JSON.parse(logs[0]);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(2);

    const alice = entries.find((e) => e.title === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.category).toBe('Entities');
    expect(alice!.path).toBe('entities/alice.md');
    expect(alice!.summary).toBe('The protagonist');
    expect(alice!.tags).toContain('person');

    const trust = entries.find((e) => e.title === 'Trust');
    expect(trust).toBeDefined();
    expect(trust!.category).toBe('Concepts');
    expect(trust!.tags).toContain('abstract');
  });

  it('should return empty JSON array for missing index', async () => {
    const logs = await runCli(['wiki', '--json', 'list', 'entries', '--path', tmpDir]);
    expect(logs).toHaveLength(1);
    const entries: IndexEntry[] = JSON.parse(logs[0]);
    expect(entries).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases                                                        */
/* ------------------------------------------------------------------ */

describe('list edge cases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'list-edge-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should handle unknown list type', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...a: unknown[]) => logs.push(a.join(' '));
    console.error = (...a: unknown[]) => errors.push(a.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'plaid', 'wiki', 'list', 'unknown', '--path', tmpDir]);
      expect(errors.join('\n')).toContain('Unknown list type');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should handle pages with missing frontmatter fields', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    // Page with no title/type/tags in frontmatter
    await writePage(join(tmpDir, 'wiki', 'bare.md'), {
      frontmatter: {},
      body: 'Minimal page.',
    });

    const logs = await runCli(['wiki', '--json', 'list', 'pages', '--path', tmpDir]);
    const pages: PageInfo[] = JSON.parse(logs[0]);
    expect(pages.length).toBe(1);
    expect(pages[0].title).toBe('');
    expect(pages[0].type).toBe('');
    expect(pages[0].tags).toEqual([]);
    expect(pages[0].path).toBe('bare.md');
  });

  it('should handle empty index file', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');

    const logs = await runCli(['wiki', '--json', 'list', 'entries', '--path', tmpDir]);
    const entries: IndexEntry[] = JSON.parse(logs[0]);
    expect(entries).toEqual([]);
  });

  it('should handle empty raw directory', async () => {
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    const logs = await runCli(['wiki', '--json', 'list', 'sources', '--path', tmpDir]);
    const sources: SourceFile[] = JSON.parse(logs[0]);
    expect(sources).toEqual([]);
  });
});

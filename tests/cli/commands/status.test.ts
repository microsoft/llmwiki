import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWikiStatus, StatusResult } from '../../../packages/cli/src/commands/status.js';
import { appendEntry } from '../../../packages/shared/src/log.js';
import { writeIndex } from '../../../packages/shared/src/index-ops.js';
import { writePage } from '../../../packages/shared/src/wiki.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from '../../../packages/cli/src/cli.js';

describe('getWikiStatus', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'status-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should handle uninitialized wiki gracefully', async () => {
    const result = await getWikiStatus(tmpDir);

    expect(result.command).toBe('status');
    expect(result.source_count).toBe(0);
    expect(result.wiki_page_count).toBe(0);
    expect(result.last_ingest_date).toBeNull();
    expect(result.last_lint_date).toBeNull();
    expect(result.orphan_page_count).toBe(0);
    expect(result.index_coverage_pct).toBe(100);
  });

  it('should count sources in raw/', async () => {
    await mkdir(join(tmpDir, 'raw'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });

    await writeFile(join(tmpDir, 'raw', 'doc1.txt'), 'content');
    await writeFile(join(tmpDir, 'raw', 'doc2.pdf'), 'content');
    await writeFile(join(tmpDir, 'raw', 'doc3.md'), 'content');

    const result = await getWikiStatus(tmpDir);
    expect(result.source_count).toBe(3);
  });

  it('should count wiki pages excluding index.md and log.md', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    // Create wiki pages
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A person page.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'idea.md'), {
      frontmatter: { type: 'concept', title: 'Idea' },
      body: 'An idea page.',
    });

    // Create index.md and log.md (should NOT be counted as pages)
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');
    await appendEntry(join(tmpDir, 'wiki', 'log.md'), {
      verb: 'initialized',
      subject: 'wiki',
      details: 'Init.',
      date: '2024-01-01',
    });

    const result = await getWikiStatus(tmpDir);
    expect(result.wiki_page_count).toBe(2);
  });

  it('should find last ingest date from log', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    const logPath = join(tmpDir, 'wiki', 'log.md');
    await appendEntry(logPath, {
      verb: 'ingested',
      subject: 'doc1.txt',
      details: 'First ingest.',
      date: '2024-01-10',
    });
    await appendEntry(logPath, {
      verb: 'linted',
      subject: 'wiki',
      details: 'Lint pass.',
      date: '2024-01-11',
    });
    await appendEntry(logPath, {
      verb: 'ingested',
      subject: 'doc2.txt',
      details: 'Second ingest.',
      date: '2024-01-15',
    });

    const result = await getWikiStatus(tmpDir);
    expect(result.last_ingest_date).toBe('2024-01-15');
    expect(result.last_lint_date).toBe('2024-01-11');
  });

  it('should report null dates when no ingest/lint entries exist', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    const logPath = join(tmpDir, 'wiki', 'log.md');
    await appendEntry(logPath, {
      verb: 'initialized',
      subject: 'wiki',
      details: 'Init.',
      date: '2024-01-01',
    });

    const result = await getWikiStatus(tmpDir);
    expect(result.last_ingest_date).toBeNull();
    expect(result.last_lint_date).toBeNull();
  });

  it('should identify orphan pages not in index', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    // Create 3 wiki pages
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A person.',
    });
    await writePage(join(tmpDir, 'wiki', 'entities', 'place.md'), {
      frontmatter: { type: 'entity', title: 'Place' },
      body: 'A place.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'idea.md'), {
      frontmatter: { type: 'concept', title: 'Idea' },
      body: 'An idea.',
    });

    // Index only person.md and idea.md — place.md is orphan
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/person.md',
        title: 'Person',
        summary: 'A person',
        category: 'Entities',
        tags: [],
      },
      {
        path: 'concepts/idea.md',
        title: 'Idea',
        summary: 'An idea',
        category: 'Concepts',
        tags: [],
      },
    ]);

    const result = await getWikiStatus(tmpDir);
    expect(result.orphan_page_count).toBe(1);
    expect(result.index_coverage_pct).toBe(67); // 2/3 → 66.67% → rounds to 67
  });

  it('should calculate 100% coverage when all pages are indexed', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A person.',
    });

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/person.md',
        title: 'Person',
        summary: 'A person',
        category: 'Entities',
        tags: [],
      },
    ]);

    const result = await getWikiStatus(tmpDir);
    expect(result.orphan_page_count).toBe(0);
    expect(result.index_coverage_pct).toBe(100);
  });

  it('should report complete stats with populated wiki', async () => {
    // Set up full wiki structure
    await mkdir(join(tmpDir, 'raw'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    // 3 raw sources
    await writeFile(join(tmpDir, 'raw', 'doc1.txt'), 'content');
    await writeFile(join(tmpDir, 'raw', 'doc2.txt'), 'content');
    await writeFile(join(tmpDir, 'raw', 'doc3.txt'), 'content');

    // 3 wiki pages
    await writePage(join(tmpDir, 'wiki', 'entities', 'alice.md'), {
      frontmatter: { type: 'entity', title: 'Alice' },
      body: 'Alice page.',
    });
    await writePage(join(tmpDir, 'wiki', 'entities', 'bob.md'), {
      frontmatter: { type: 'entity', title: 'Bob' },
      body: 'Bob page.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'trust.md'), {
      frontmatter: { type: 'concept', title: 'Trust' },
      body: 'Trust page.',
    });

    // Index has 2 of 3 pages (bob.md is orphan)
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/alice.md',
        title: 'Alice',
        summary: 'Alice',
        category: 'Entities',
        tags: ['person'],
      },
      {
        path: 'concepts/trust.md',
        title: 'Trust',
        summary: 'Trust concept',
        category: 'Concepts',
        tags: ['abstract'],
      },
    ]);

    // Log with ingest and lint entries
    const logPath = join(tmpDir, 'wiki', 'log.md');
    await appendEntry(logPath, {
      verb: 'ingested',
      subject: 'doc1.txt',
      details: 'Ingested doc1.',
      date: '2024-01-10',
    });
    await appendEntry(logPath, {
      verb: 'ingested',
      subject: 'doc2.txt',
      details: 'Ingested doc2.',
      date: '2024-01-12',
    });
    await appendEntry(logPath, {
      verb: 'linted',
      subject: 'wiki',
      details: 'Lint pass.',
      date: '2024-01-13',
    });

    const result = await getWikiStatus(tmpDir);
    expect(result.command).toBe('status');
    expect(result.source_count).toBe(3);
    expect(result.wiki_page_count).toBe(3);
    expect(result.last_ingest_date).toBe('2024-01-12');
    expect(result.last_lint_date).toBe('2024-01-13');
    expect(result.orphan_page_count).toBe(1);
    expect(result.index_coverage_pct).toBe(67);
  });

  it('should calculate 0% coverage when no pages are indexed', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'raw'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A person.',
    });
    await writePage(join(tmpDir, 'wiki', 'entities', 'place.md'), {
      frontmatter: { type: 'entity', title: 'Place' },
      body: 'A place.',
    });

    // Empty index — no entries
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');

    const result = await getWikiStatus(tmpDir);
    expect(result.wiki_page_count).toBe(2);
    expect(result.orphan_page_count).toBe(2);
    expect(result.index_coverage_pct).toBe(0);
  });
});

describe('status CLI integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'status-cli-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should register status command with --path option', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const status = wiki!.commands.find((cmd) => cmd.name() === 'status');
    expect(status).toBeDefined();
    expect(status!.description()).toBe(
      'Show wiki knowledge base status and statistics',
    );

    const pathOption = status!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();
  });

  it('should output JSON when --json flag is set', async () => {
    await mkdir(join(tmpDir, 'raw'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        '--json',
        'status',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]) as StatusResult;
      expect(result.command).toBe('status');
      expect(result.source_count).toBe(0);
      expect(result.wiki_page_count).toBe(0);
      expect(result.last_ingest_date).toBeNull();
      expect(result.last_lint_date).toBeNull();
      expect(result.orphan_page_count).toBe(0);
      expect(result.index_coverage_pct).toBe(100);
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-readable table by default', async () => {
    await mkdir(join(tmpDir, 'raw'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'status',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Wiki Status');
      expect(output).toContain('Sources');
      expect(output).toContain('Wiki pages');
      expect(output).toContain('Last ingest');
      expect(output).toContain('Last lint');
      expect(output).toContain('Orphan pages');
      expect(output).toContain('Index coverage');
    } finally {
      console.log = origLog;
    }
  });

  it('should handle uninitialized wiki in JSON mode', async () => {
    // tmpDir has no raw/ or wiki/ — completely uninitialized
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        '--json',
        'status',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]) as StatusResult;
      expect(result.source_count).toBe(0);
      expect(result.wiki_page_count).toBe(0);
      expect(result.orphan_page_count).toBe(0);
    } finally {
      console.log = origLog;
    }
  });

  it('should output JSON with populated wiki stats', async () => {
    await mkdir(join(tmpDir, 'raw'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writeFile(join(tmpDir, 'raw', 'source.txt'), 'data');
    await writePage(join(tmpDir, 'wiki', 'entities', 'item.md'), {
      frontmatter: { type: 'entity', title: 'Item' },
      body: 'An item.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/item.md',
        title: 'Item',
        summary: 'An item',
        category: 'Entities',
        tags: [],
      },
    ]);
    await appendEntry(join(tmpDir, 'wiki', 'log.md'), {
      verb: 'ingested',
      subject: 'source.txt',
      details: 'Done.',
      date: '2024-03-01',
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        '--json',
        'status',
        '--path',
        tmpDir,
      ]);

      const result = JSON.parse(logs[0]) as StatusResult;
      expect(result.source_count).toBe(1);
      expect(result.wiki_page_count).toBe(1);
      expect(result.last_ingest_date).toBe('2024-03-01');
      expect(result.orphan_page_count).toBe(0);
      expect(result.index_coverage_pct).toBe(100);
    } finally {
      console.log = origLog;
    }
  });
});

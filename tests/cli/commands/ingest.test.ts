import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ingestSource } from '../../../packages/cli/src/commands/ingest.js';
import { readPage } from '../../../packages/shared/src/wiki.js';
import { readIndex } from '../../../packages/shared/src/index-ops.js';
import { readLog } from '../../../packages/shared/src/log.js';
import { initWiki } from '../../../packages/cli/src/commands/init.js';
import { createProgram } from '../../../packages/cli/src/cli.js';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ingestSource', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ingest-test-'));
    await initWiki(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create a summary page for a markdown source file', async () => {
    const sourceFile = join(tmpDir, 'raw', 'my-document.md');
    await writeFile(sourceFile, '# Hello World\n\nThis is a test document.', 'utf-8');

    const result = await ingestSource(sourceFile, tmpDir, false);

    expect(result.command).toBe('ingest');
    expect(result.status).toBe('success');
    expect(result.dry_run).toBe(false);
    expect(result.pages_created).toContain('sources/my-document-summary.md');
    expect(result.pages_updated).toContain('index.md');
    expect(result.pages_updated).toContain('log.md');

    // Verify summary page was created with frontmatter
    const summaryPath = join(tmpDir, 'wiki', 'sources', 'my-document-summary.md');
    const page = await readPage(summaryPath);
    expect(page.frontmatter.type).toBe('source');
    expect(page.frontmatter.title).toBe('my-document.md');
    expect(page.frontmatter.source_path).toBe('raw/my-document.md');
    expect(page.frontmatter.ingested).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.frontmatter.tags).toEqual([]);
    expect(page.body).toContain('Hello World');
  });

  it('should update wiki/index.md with new entry in Sources category', async () => {
    const sourceFile = join(tmpDir, 'raw', 'notes.txt');
    await writeFile(sourceFile, 'Some notes here.', 'utf-8');

    await ingestSource(sourceFile, tmpDir, false);

    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    const sourceEntry = entries.find((e) => e.path === 'sources/notes-summary.md');
    expect(sourceEntry).toBeDefined();
    expect(sourceEntry!.title).toBe('notes.txt');
    expect(sourceEntry!.category).toBe('Sources');
  });

  it('should append ingest entry to wiki/log.md', async () => {
    const sourceFile = join(tmpDir, 'raw', 'report.md');
    await writeFile(sourceFile, 'Report content.', 'utf-8');

    await ingestSource(sourceFile, tmpDir, false);

    const logEntries = await readLog(join(tmpDir, 'wiki', 'log.md'));
    // log.md has init entry + ingest entry
    const ingestEntry = logEntries.find((e) => e.verb === 'ingested');
    expect(ingestEntry).toBeDefined();
    expect(ingestEntry!.subject).toBe('report.md');
    expect(ingestEntry!.details).toContain('report.md');
    expect(ingestEntry!.details).toContain('sources/report-summary.md');
  });

  it('should include content excerpt in summary page body', async () => {
    const sourceFile = join(tmpDir, 'raw', 'article.md');
    const content = 'This is the beginning of a very important article about testing.';
    await writeFile(sourceFile, content, 'utf-8');

    await ingestSource(sourceFile, tmpDir, false);

    const summaryPath = join(tmpDir, 'wiki', 'sources', 'article-summary.md');
    const page = await readPage(summaryPath);
    expect(page.body).toContain('Content Preview');
    expect(page.body).toContain('This is the beginning');
  });

  it('should truncate excerpt for large files', async () => {
    const sourceFile = join(tmpDir, 'raw', 'big-file.txt');
    const longContent = 'A'.repeat(600);
    await writeFile(sourceFile, longContent, 'utf-8');

    await ingestSource(sourceFile, tmpDir, false);

    const summaryPath = join(tmpDir, 'wiki', 'sources', 'big-file-summary.md');
    const page = await readPage(summaryPath);
    // Should have truncation indicator
    expect(page.body).toContain('…');
  });

  it('should not write files when --dry-run is true', async () => {
    const sourceFile = join(tmpDir, 'raw', 'test-dry.md');
    await writeFile(sourceFile, 'Dry run content.', 'utf-8');

    const result = await ingestSource(sourceFile, tmpDir, true);

    expect(result.status).toBe('success');
    expect(result.dry_run).toBe(true);
    expect(result.pages_created).toContain('sources/test-dry-summary.md');
    expect(result.pages_updated).toContain('index.md');
    expect(result.pages_updated).toContain('log.md');

    // Verify no summary page was created
    const summaryPath = join(tmpDir, 'wiki', 'sources', 'test-dry-summary.md');
    await expect(readFile(summaryPath, 'utf-8')).rejects.toThrow();

    // Verify index was not updated (should still be empty from init)
    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries).toHaveLength(0);

    // Verify log only has init entry
    const logEntries = await readLog(join(tmpDir, 'wiki', 'log.md'));
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].verb).toBe('initialized');
  });

  it('should return error for missing source file', async () => {
    const result = await ingestSource(
      join(tmpDir, 'raw', 'nonexistent.md'),
      tmpDir,
      false,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Source file not found');
    expect(result.pages_created).toEqual([]);
    expect(result.pages_updated).toEqual([]);
  });

  it('should return error for uninitialized wiki', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'ingest-noinit-'));
    try {
      const sourceFile = join(emptyDir, 'test.md');
      await writeFile(sourceFile, 'content', 'utf-8');

      const result = await ingestSource(sourceFile, emptyDir, false);

      expect(result.status).toBe('error');
      expect(result.error).toContain('not initialized');
      expect(result.pages_created).toEqual([]);
      expect(result.pages_updated).toEqual([]);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('should handle .txt source files', async () => {
    const sourceFile = join(tmpDir, 'raw', 'data.txt');
    await writeFile(sourceFile, 'Plain text content.', 'utf-8');

    const result = await ingestSource(sourceFile, tmpDir, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/data-summary.md');

    const summaryPath = join(tmpDir, 'wiki', 'sources', 'data-summary.md');
    const page = await readPage(summaryPath);
    expect(page.frontmatter.title).toBe('data.txt');
    expect(page.body).toContain('.txt');
  });

  it('should slugify filenames with spaces and special characters', async () => {
    const sourceFile = join(tmpDir, 'raw', 'My Research Paper (2024).md');
    await writeFile(sourceFile, 'Research content.', 'utf-8');

    const result = await ingestSource(sourceFile, tmpDir, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/my-research-paper-2024-summary.md');
  });

  it('should include metadata in summary page body', async () => {
    const sourceFile = join(tmpDir, 'raw', 'sample.md');
    await writeFile(sourceFile, 'Sample content for metadata test.', 'utf-8');

    await ingestSource(sourceFile, tmpDir, false);

    const summaryPath = join(tmpDir, 'wiki', 'sources', 'sample-summary.md');
    const page = await readPage(summaryPath);
    expect(page.body).toContain('sample.md');
    expect(page.body).toContain('raw/sample.md');
    expect(page.body).toContain('bytes');
  });

  it('should reject source path that escapes project root via ../', async () => {
    const result = await ingestSource('../../etc/passwd', tmpDir, false);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Source path escapes project root');
    expect(result.pages_created).toEqual([]);
    expect(result.pages_updated).toEqual([]);
  });

  it('should reject absolute path outside project root', async () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows\\System32\\config' : '/etc/passwd';
    const result = await ingestSource(outsidePath, tmpDir, false);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Source path escapes project root');
    expect(result.pages_created).toEqual([]);
    expect(result.pages_updated).toEqual([]);
  });

  it('should accept source path within project root', async () => {
    const sourceFile = join(tmpDir, 'raw', 'valid-source.md');
    await writeFile(sourceFile, 'Valid content.', 'utf-8');

    const result = await ingestSource(sourceFile, tmpDir, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/valid-source-summary.md');
  });
});

describe('ingest CLI integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ingest-cli-'));
    await initWiki(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should register ingest command with required argument and options', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const ingest = wiki!.commands.find((cmd) => cmd.name() === 'ingest');
    expect(ingest).toBeDefined();
    expect(ingest!.description()).toBe('Ingest a source file into the wiki knowledge base');

    const pathOption = ingest!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();

    const dryRunOption = ingest!.options.find((opt) => opt.long === '--dry-run');
    expect(dryRunOption).toBeDefined();
  });

  it('should output JSON when --json flag is set', async () => {
    const sourceFile = join(tmpDir, 'raw', 'cli-test.md');
    await writeFile(sourceFile, 'CLI test content.', 'utf-8');

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
        'ingest',
        sourceFile,
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.command).toBe('ingest');
      expect(result.status).toBe('success');
      expect(result.pages_created).toContain('sources/cli-test-summary.md');
      expect(result.pages_updated).toContain('index.md');
      expect(result.pages_updated).toContain('log.md');
      expect(result.dry_run).toBe(false);
    } finally {
      console.log = origLog;
    }
  });

  it('should output JSON with error for missing source', async () => {
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
        'ingest',
        join(tmpDir, 'raw', 'missing.md'),
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Source file not found');
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-friendly text for successful ingest', async () => {
    const sourceFile = join(tmpDir, 'raw', 'human-test.md');
    await writeFile(sourceFile, 'Human-readable test.', 'utf-8');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'ingest',
        sourceFile,
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Source ingested successfully');
    } finally {
      console.log = origLog;
    }
  });

  it('should output dry-run text with --dry-run flag', async () => {
    const sourceFile = join(tmpDir, 'raw', 'dry-cli.md');
    await writeFile(sourceFile, 'Dry run CLI test.', 'utf-8');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'ingest',
        sourceFile,
        '--path',
        tmpDir,
        '--dry-run',
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Dry run');
      expect(output).toContain('Would create');
      expect(output).toContain('Would update');
    } finally {
      console.log = origLog;
    }
  });

  it('should output JSON with --dry-run flag', async () => {
    const sourceFile = join(tmpDir, 'raw', 'dry-json.md');
    await writeFile(sourceFile, 'Dry run JSON test.', 'utf-8');

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
        'ingest',
        sourceFile,
        '--path',
        tmpDir,
        '--dry-run',
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.status).toBe('success');
      expect(result.dry_run).toBe(true);
      expect(result.pages_created).toContain('sources/dry-json-summary.md');
    } finally {
      console.log = origLog;
    }
  });

  it('should output error text for missing source file', async () => {
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'ingest',
        join(tmpDir, 'raw', 'missing.md'),
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Source file not found');
    } finally {
      console.error = origErr;
    }
  });
});

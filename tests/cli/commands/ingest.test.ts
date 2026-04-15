import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ingestSource } from '../../../packages/cli/src/commands/ingest.js';
import { readPage } from '../../../packages/shared/src/wiki.js';
import { readIndex } from '../../../packages/shared/src/index-ops.js';
import { readLog } from '../../../packages/shared/src/log.js';
import { initWiki } from '../../../packages/shared/src/init.js';
import { createProgram } from '../../../packages/cli/src/cli.js';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WIKI_DIR_NAME } from '../../../packages/shared/src/constants.js';

// Mock copilot CLI to avoid hitting real Copilot binary in tests
const { MockCopilotCliError } = vi.hoisted(() => {
  class MockCopilotCliError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'CopilotCliError';
      this.code = code;
    }
  }
  return { MockCopilotCliError };
});

vi.mock('../../../packages/cli/src/copilot-cli.js', () => ({
  CopilotCliError: MockCopilotCliError,
  runCopilotCli: vi.fn().mockRejectedValue(
    new MockCopilotCliError('GitHub Copilot CLI is not installed (mocked)', 'NOT_INSTALLED'),
  ),
  isCopilotCliAvailable: vi.fn().mockResolvedValue(false),
}));

describe('ingestSource', () => {
  let tmpDir: string;
  let wikiRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ingest-test-'));
    await initWiki(tmpDir);
    wikiRoot = join(tmpDir, WIKI_DIR_NAME);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create a summary page for a markdown source file', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'my-document.md');
    await writeFile(sourceFile, '# Hello World\n\nThis is a test document.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false);

    expect(result.command).toBe('ingest');
    expect(result.status).toBe('success');
    expect(result.dry_run).toBe(false);
    expect(result.pages_created).toContain('sources/my-document-summary.md');
    expect(result.pages_updated).toContain('index.md');
    expect(result.pages_updated).toContain('log.md');

    // Verify summary page was created with frontmatter
    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'my-document-summary.md');
    const page = await readPage(summaryPath);
    expect(page.frontmatter.type).toBe('source');
    expect(page.frontmatter.title).toBe('my-document.md');
    expect(page.frontmatter.source_path).toBe('raw/my-document.md');
    expect(page.frontmatter.ingested).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.frontmatter.tags).toEqual([]);
    expect(page.body).toContain('Hello World');
  });

  it('should update wiki/index.md with new entry in Sources category', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'notes.txt');
    await writeFile(sourceFile, 'Some notes here.', 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);

    const entries = await readIndex(join(wikiRoot, 'wiki', 'index.md'));
    const sourceEntry = entries.find((e) => e.path === 'sources/notes-summary.md');
    expect(sourceEntry).toBeDefined();
    expect(sourceEntry!.title).toBe('notes.txt');
    expect(sourceEntry!.category).toBe('Sources');
  });

  it('should append ingest entry to wiki/log.md', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'report.md');
    await writeFile(sourceFile, 'Report content.', 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);

    const logEntries = await readLog(join(wikiRoot, 'wiki', 'log.md'));
    // log.md has init entry + ingest entry
    const ingestEntry = logEntries.find((e) => e.verb === 'ingested');
    expect(ingestEntry).toBeDefined();
    expect(ingestEntry!.subject).toBe('report.md');
    expect(ingestEntry!.details).toContain('report.md');
    expect(ingestEntry!.details).toContain('sources/report-summary.md');
  });

  it('should include content excerpt in summary page body', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'article.md');
    const content = 'This is the beginning of a very important article about testing.';
    await writeFile(sourceFile, content, 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);

    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'article-summary.md');
    const page = await readPage(summaryPath);
    expect(page.body).toContain('Content Preview');
    expect(page.body).toContain('This is the beginning');
  });

  it('should truncate excerpt for large files', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'big-file.txt');
    const longContent = 'A'.repeat(600);
    await writeFile(sourceFile, longContent, 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);

    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'big-file-summary.md');
    const page = await readPage(summaryPath);
    // Should have truncation indicator
    expect(page.body).toContain('…');
  });

  it('should not write files when --dry-run is true', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'test-dry.md');
    await writeFile(sourceFile, 'Dry run content.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, true);

    expect(result.status).toBe('success');
    expect(result.dry_run).toBe(true);
    expect(result.pages_created).toContain('sources/test-dry-summary.md');
    expect(result.pages_updated).toContain('index.md');
    expect(result.pages_updated).toContain('log.md');

    // Verify no summary page was created
    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'test-dry-summary.md');
    await expect(readFile(summaryPath, 'utf-8')).rejects.toThrow();

    // Verify index was not updated (should still be empty from init)
    const entries = await readIndex(join(wikiRoot, 'wiki', 'index.md'));
    expect(entries).toHaveLength(0);

    // Verify log only has init entry
    const logEntries = await readLog(join(wikiRoot, 'wiki', 'log.md'));
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].verb).toBe('initialized');
  });

  it('should return error for missing source file', async () => {
    const result = await ingestSource(
      join(wikiRoot, 'raw', 'nonexistent.md'),
      wikiRoot,
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
    const sourceFile = join(wikiRoot, 'raw', 'data.txt');
    await writeFile(sourceFile, 'Plain text content.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/data-summary.md');

    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'data-summary.md');
    const page = await readPage(summaryPath);
    expect(page.frontmatter.title).toBe('data.txt');
    expect(page.body).toContain('.txt');
  });

  it('should slugify filenames with spaces and special characters', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'My Research Paper (2024).md');
    await writeFile(sourceFile, 'Research content.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/my-research-paper-2024-summary.md');
  });

  it('should include metadata in summary page body', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'sample.md');
    await writeFile(sourceFile, 'Sample content for metadata test.', 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);

    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'sample-summary.md');
    const page = await readPage(summaryPath);
    expect(page.body).toContain('sample.md');
    expect(page.body).toContain('raw/sample.md');
    expect(page.body).toContain('bytes');
  });

  it('should reject source path that escapes project root via ../', async () => {
    const result = await ingestSource('../../etc/passwd', wikiRoot, false);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Source path escapes project root');
    expect(result.pages_created).toEqual([]);
    expect(result.pages_updated).toEqual([]);
  });

  it('should reject absolute path outside project root', async () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows\\System32\\config' : '/etc/passwd';
    const result = await ingestSource(outsidePath, wikiRoot, false);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Source path escapes project root');
    expect(result.pages_created).toEqual([]);
    expect(result.pages_updated).toEqual([]);
  });

  it('should accept source path within project root', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'valid-source.md');
    await writeFile(sourceFile, 'Valid content.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/valid-source-summary.md');
  });

  it('should accept source path in project root but outside .wiki/', async () => {
    const sourceFile = join(tmpDir, 'samples', 'outside-wiki.md');
    await mkdir(join(tmpDir, 'samples'), { recursive: true });
    await writeFile(sourceFile, 'Content outside .wiki dir.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/outside-wiki-summary.md');
  });

  it('should return skipped when ingesting same source twice without --force', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'duplicate.md');
    await writeFile(sourceFile, 'Duplicate detection test.', 'utf-8');

    const first = await ingestSource(sourceFile, wikiRoot, false);
    expect(first.status).toBe('success');

    const second = await ingestSource(sourceFile, wikiRoot, false);
    expect(second.status).toBe('skipped');
    expect(second.message).toBe('Source already ingested. Use --force to re-ingest.');
    expect(second.pages_created).toEqual([]);
    expect(second.pages_updated).toEqual([]);
  });

  it('should overwrite and return success when force=true on duplicate', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'force-test.md');
    await writeFile(sourceFile, 'Original content.', 'utf-8');

    const first = await ingestSource(sourceFile, wikiRoot, false);
    expect(first.status).toBe('success');

    // Update source content then force re-ingest
    await writeFile(sourceFile, 'Updated content for force.', 'utf-8');
    const second = await ingestSource(sourceFile, wikiRoot, false, true);
    expect(second.status).toBe('success');
    expect(second.pages_created).toContain('sources/force-test-summary.md');

    // Verify updated content is in the summary
    const summaryPath = join(wikiRoot, 'wiki', 'sources', 'force-test-summary.md');
    const raw = await readFile(summaryPath, 'utf-8');
    expect(raw).toContain('Updated content for force.');
  });

  it('should not create duplicate index entries on force re-ingest', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'no-dup-index.md');
    await writeFile(sourceFile, 'Index dup test.', 'utf-8');

    await ingestSource(sourceFile, wikiRoot, false);
    await ingestSource(sourceFile, wikiRoot, false, true);

    const entries = await readIndex(join(wikiRoot, 'wiki', 'index.md'));
    const matches = entries.filter((e) => e.path === 'sources/no-dup-index-summary.md');
    expect(matches).toHaveLength(1);
  });

  it('should still work for clean first-time ingest (regression)', async () => {
    const sourceFile = join(wikiRoot, 'raw', 'fresh.md');
    await writeFile(sourceFile, 'Brand new content.', 'utf-8');

    const result = await ingestSource(sourceFile, wikiRoot, false, false);

    expect(result.status).toBe('success');
    expect(result.pages_created).toContain('sources/fresh-summary.md');
    expect(result.pages_updated).toContain('index.md');
    expect(result.pages_updated).toContain('log.md');
  });
});

describe('ingest CLI integration', () => {
  let tmpDir: string;
  let rawDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ingest-cli-'));
    await initWiki(tmpDir);
    rawDir = join(tmpDir, WIKI_DIR_NAME, 'raw');
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
    expect(ingest!.description()).toBe('Ingest source file(s) into the wiki knowledge base');

    const pathOption = ingest!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();

    const dryRunOption = ingest!.options.find((opt) => opt.long === '--dry-run');
    expect(dryRunOption).toBeDefined();
  });

  it('should output JSON when --json flag is set', async () => {
    const sourceFile = join(rawDir, 'cli-test.md');
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

      // Copilot CLI is not available in test — expect error JSON
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const result = JSON.parse(logs[logs.length - 1]);
      expect(result.code).toBe('NOT_INSTALLED');
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
        join(rawDir, 'missing.md'),
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.status).toBe('error');
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-friendly text for successful ingest', async () => {
    const sourceFile = join(rawDir, 'human-test.md');
    await writeFile(sourceFile, 'Human-readable test.', 'utf-8');

    const logs: string[] = [];
    const errLogs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => errLogs.push(args.join(' '));

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
      expect(output).toContain('Indexed:');
      // Copilot CLI not available in tests — expect the error
      const errOutput = errLogs.join('\n');
      expect(errOutput).toContain('Copilot CLI');
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it('should output dry-run text with --dry-run flag', async () => {
    const sourceFile = join(rawDir, 'dry-cli.md');
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
    const sourceFile = join(rawDir, 'dry-json.md');
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
        join(rawDir, 'missing.md'),
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('not found');
    } finally {
      console.error = origErr;
    }
  });

  it('should output skipped status in JSON when source already ingested', async () => {
    const sourceFile = join(rawDir, 'skip-json.md');
    await writeFile(sourceFile, 'Skip JSON test.', 'utf-8');

    // First ingest
    const program1 = createProgram();
    await program1.parseAsync([
      'node',
      'plaid',
      'wiki',
      'ingest',
      sourceFile,
      '--path',
      tmpDir,
    ]);

    // Second ingest with JSON
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program2 = createProgram();
      await program2.parseAsync([
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
      expect(result.status).toBe('skipped');
      expect(result.message).toBe('Source already ingested. Use --force to re-ingest.');
    } finally {
      console.log = origLog;
    }
  });

  it('should register --force option on ingest command', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    const ingest = wiki!.commands.find((cmd) => cmd.name() === 'ingest');
    const forceOption = ingest!.options.find((opt) => opt.long === '--force');
    expect(forceOption).toBeDefined();
  });
});

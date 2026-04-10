import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWiki } from '../../../packages/cli/src/commands/init.js';
import { readLog } from '../../../packages/shared/src/log.js';
import { readIndex } from '../../../packages/shared/src/index-ops.js';
import { mkdtemp, rm, readFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from '../../../packages/cli/src/cli.js';

describe('initWiki', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'init-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create all required directories', async () => {
    await initWiki(tmpDir);

    const expectedDirs = [
      'raw',
      'wiki',
      'wiki/entities',
      'wiki/concepts',
      'wiki/sources',
    ];

    for (const dir of expectedDirs) {
      const dirStat = await stat(join(tmpDir, dir));
      expect(dirStat.isDirectory(), `${dir} should be a directory`).toBe(true);
    }
  });

  it('should create wiki/index.md with category headers', async () => {
    await initWiki(tmpDir);

    const indexContent = await readFile(
      join(tmpDir, 'wiki', 'index.md'),
      'utf-8',
    );

    expect(indexContent).toContain('# Wiki Index');
    expect(indexContent).toContain('## Entities');
    expect(indexContent).toContain('## Concepts');
    expect(indexContent).toContain('## Sources');
  });

  it('should create wiki/index.md parseable by readIndex', async () => {
    await initWiki(tmpDir);

    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    // Index should be empty but valid (no entries, just category headers)
    expect(entries).toEqual([]);
  });

  it('should create wiki/log.md with initialization entry', async () => {
    await initWiki(tmpDir);

    const logEntries = await readLog(join(tmpDir, 'wiki', 'log.md'));
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].verb).toBe('initialized');
    expect(logEntries[0].subject).toBe('wiki');
    expect(logEntries[0].details).toContain('initialized');
    expect(logEntries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should create AGENTS.md with starter schema', async () => {
    await initWiki(tmpDir);

    const agentsContent = await readFile(
      join(tmpDir, 'AGENTS.md'),
      'utf-8',
    );

    expect(agentsContent).toContain('# AGENTS.md');
    expect(agentsContent).toContain('entity');
    expect(agentsContent).toContain('concept');
    expect(agentsContent).toContain('source');
    expect(agentsContent).toContain('Frontmatter Schema');
    expect(agentsContent).toContain('summary');
    expect(agentsContent).toContain('query');
    expect(agentsContent).toContain('Query Page Frontmatter');
    expect(agentsContent).toContain('plaid wiki query --save');
    expect(agentsContent).toContain('results_count');
    expect(agentsContent).toContain('Naming Conventions');
    expect(agentsContent).toContain('Ingest Workflow');
    expect(agentsContent).toContain('Lint Rules');
    expect(agentsContent).toContain('Cross-Referencing');
    expect(agentsContent).toContain('broken-links');
    expect(agentsContent).toContain('orphan-pages');
  });

  it('should return created status with dirs and files', async () => {
    const result = await initWiki(tmpDir);

    expect(result.command).toBe('init');
    expect(result.status).toBe('created');
    expect(result.created_dirs).toContain('raw');
    expect(result.created_dirs).toContain('wiki');
    expect(result.created_dirs).toContain('wiki/entities');
    expect(result.created_dirs).toContain('wiki/concepts');
    expect(result.created_dirs).toContain('wiki/sources');
    expect(result.created_files).toContain('wiki/index.md');
    expect(result.created_files).toContain('wiki/log.md');
    expect(result.created_files).toContain('AGENTS.md');
    expect(result.warning).toBeUndefined();
  });

  it('should warn if already initialized', async () => {
    // First init
    await initWiki(tmpDir);

    // Second init
    const result = await initWiki(tmpDir);

    expect(result.status).toBe('already_initialized');
    expect(result.created_dirs).toEqual([]);
    expect(result.created_files).toEqual([]);
    expect(result.warning).toContain('already initialized');
  });

  it('should work with a nested target path', async () => {
    const nestedPath = join(tmpDir, 'sub', 'project');

    const result = await initWiki(nestedPath);

    expect(result.status).toBe('created');

    const dirStat = await stat(join(nestedPath, 'wiki', 'entities'));
    expect(dirStat.isDirectory()).toBe(true);

    const indexContent = await readFile(
      join(nestedPath, 'wiki', 'index.md'),
      'utf-8',
    );
    expect(indexContent).toContain('# Wiki Index');
  });
});

describe('init CLI integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'init-cli-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should register init command with --path option', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const init = wiki!.commands.find((cmd) => cmd.name() === 'init');
    expect(init).toBeDefined();
    expect(init!.description()).toBe(
      'Initialize a new wiki knowledge base',
    );

    const pathOption = init!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();
  });

  it('should output JSON when --json flag is set', async () => {
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
        'init',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.command).toBe('init');
      expect(result.status).toBe('created');
      expect(result.created_dirs).toContain('wiki');
      expect(result.created_files).toContain('wiki/index.md');
    } finally {
      console.log = origLog;
    }
  });

  it('should output JSON with warning when already initialized', async () => {
    // Pre-create wiki dir to trigger "already initialized"
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
        '--json',
        'init',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.status).toBe('already_initialized');
      expect(result.warning).toContain('already initialized');
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-friendly text by default', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'init',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Wiki initialized successfully');
    } finally {
      console.log = origLog;
    }
  });

  it('should output warning text when already initialized', async () => {
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
        'init',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('already initialized');
    } finally {
      console.log = origLog;
    }
  });
});

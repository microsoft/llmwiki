import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── Helpers ─────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'packages', 'cli', 'dist', 'cli.js');
const NODE = process.execPath;
const WIKI_DIR = '.wiki';

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI as a subprocess.
 *
 * @param args   Arguments after `wiki`, e.g. `['init', '--path', dir]`
 * @param cwd    Working directory for the subprocess
 * @param json   Whether to pass `--json` on the wiki command
 */
function runCLI(
  args: string[],
  cwd: string,
  json = false,
): Promise<RunResult> {
  const wikiArgs = json ? ['--json', ...args] : args;
  const fullArgs = [CLI_PATH, 'wiki', ...wikiArgs];

  return new Promise((resolve) => {
    execFile(NODE, fullArgs, { cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: error?.code != null ? (error.code as unknown as number) : 0,
      });
    });
  });
}

/**
 * Create a sample markdown source file inside the given directory.
 * Returns the path to the created file.
 */
async function createSampleSource(
  dir: string,
  name = 'sample.md',
  content?: string,
): Promise<string> {
  const rawDir = join(dir, WIKI_DIR, 'raw');
  await mkdir(rawDir, { recursive: true });
  const filePath = join(rawDir, name);
  await writeFile(
    filePath,
    content ??
      `# Neural Networks\n\nNeural networks are computing systems inspired by biological neural networks.\n`,
    'utf-8',
  );
  return filePath;
}

// ── Tests ───────────────────────────────────────────────────────

describe('E2E: CLI integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmwiki-e2e-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────
  // init
  // ────────────────────────────────────────────────────────────

  describe('init', () => {
    it('should initialize a new wiki (human-readable)', async () => {
      const { stdout, exitCode } = await runCLI(['init', '--path', tempDir], tempDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Wiki initialized successfully');
      expect(stdout).toContain('Directories:');
      expect(stdout).toContain('Files:');
    });

    it('should initialize a new wiki (--json)', async () => {
      const { stdout, exitCode } = await runCLI(
        ['init', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.command).toBe('init');
      expect(result.status).toBe('created');
      expect(result.created_dirs).toContain('wiki');
      expect(result.created_dirs).toContain('raw');
      expect(result.created_files).toContain('wiki/index.md');
      expect(result.created_files).toContain('wiki/log.md');
      expect(result.created_files).toContain('AGENTS.md');
    });

    it('should be idempotent — reports already initialized', async () => {
      // First init
      await runCLI(['init', '--path', tempDir], tempDir);

      // Second init
      const { stdout, exitCode } = await runCLI(
        ['init', '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('already initialized');
    });

    it('should report already_initialized in JSON mode', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout } = await runCLI(
        ['init', '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.status).toBe('already_initialized');
      expect(result.created_dirs).toEqual([]);
      expect(result.created_files).toEqual([]);
      expect(result.warning).toContain('already initialized');
    });

    it('should create the expected directory structure', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const indexContent = await readFile(
        join(tempDir, WIKI_DIR, 'wiki', 'index.md'),
        'utf-8',
      );
      expect(indexContent).toContain('# Wiki Index');
      expect(indexContent).toContain('## Entities');
      expect(indexContent).toContain('## Concepts');
      expect(indexContent).toContain('## Sources');

      const logContent = await readFile(
        join(tempDir, WIKI_DIR, 'wiki', 'log.md'),
        'utf-8',
      );
      expect(logContent).toContain('initialized');

      const agentsContent = await readFile(
        join(tempDir, WIKI_DIR, 'AGENTS.md'),
        'utf-8',
      );
      expect(agentsContent).toContain('# AGENTS.md');
    });
  });

  // ────────────────────────────────────────────────────────────
  // ingest
  // ────────────────────────────────────────────────────────────

  describe('ingest', () => {
    it('should ingest a source file (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);

      const { stdout, stderr, exitCode } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
      );

      // Copilot CLI is not available in CI — ingest fails after mechanical step
      expect(exitCode).toBe(1);
      expect(stdout).toContain('Source ingested');
      expect(stdout).toContain('Created:');
      expect(stdout).toContain('Updated:');
      expect(stderr).toContain('Copilot CLI');
    });

    it('should ingest a source file (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);

      const { stdout, exitCode } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
        true,
      );

      // Copilot CLI is not available in CI — expect error JSON
      expect(exitCode).toBe(1);
      const result = JSON.parse(stdout);
      expect(result.code).toBe('NOT_INSTALLED');
    });

    it('should support --dry-run', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);

      const { stdout, exitCode } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir, '--dry-run'],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Dry run');
      expect(stdout).toContain('Would create:');
      expect(stdout).toContain('Would update:');
    });

    it('should error on uninitialized wiki (human-readable)', async () => {
      const sourcePath = await createSampleSource(tempDir);

      const { stderr, exitCode } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Wiki is not initialized');
    });

    it('should error on uninitialized wiki (--json)', async () => {
      const sourcePath = await createSampleSource(tempDir);

      const { stdout } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.status).toBe('error');
      expect(result.error).toContain('Wiki is not initialized');
    });

    it('should error on missing source file (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stderr, exitCode } = await runCLI(
        ['ingest', join(tempDir, WIKI_DIR, 'raw', 'nonexistent.md'), '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });

    it('should error on missing source file (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout } = await runCLI(
        ['ingest', join(tempDir, WIKI_DIR, 'raw', 'nonexistent.md'), '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.status).toBe('error');
    });

    it('should create summary page on disk', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir, 'sample.md');

      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const summaryContent = await readFile(
        join(tempDir, WIKI_DIR, 'wiki', 'sources', 'sample-summary.md'),
        'utf-8',
      );
      expect(summaryContent).toContain('type: source');
      expect(summaryContent).toContain('sample.md');
      expect(summaryContent).toContain('Neural Networks');
    });
  });

  // ────────────────────────────────────────────────────────────
  // status
  // ────────────────────────────────────────────────────────────

  describe('status', () => {
    it('should show status of an initialized wiki (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Wiki Status');
      expect(stdout).toContain('Sources (raw/)');
      expect(stdout).toContain('Wiki pages (wiki/)');
      expect(stdout).toContain('Last ingest');
      expect(stdout).toContain('Last lint');
      expect(stdout).toContain('Orphan pages');
      expect(stdout).toContain('Index coverage');
    });

    it('should show status (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.command).toBe('status');
      expect(result.source_count).toBe(0);
      expect(result.wiki_page_count).toBe(0);
      expect(result.last_ingest_date).toBeNull();
      expect(result.last_lint_date).toBeNull();
      expect(result.orphan_page_count).toBe(0);
      expect(result.index_coverage_pct).toBe(100);
    });

    it('should reflect ingested sources in status', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.source_count).toBe(1);
      expect(result.wiki_page_count).toBe(1);
      expect(result.last_ingest_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.index_coverage_pct).toBe(100);
    });
  });

  // ────────────────────────────────────────────────────────────
  // lint
  // ────────────────────────────────────────────────────────────

  describe('lint', () => {
    it('should report no issues on a clean wiki (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('No lint issues found');
    });

    it('should report no issues on a clean wiki (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.command).toBe('lint');
      expect(result.findings).toEqual([]);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.infoCount).toBe(0);
    });

    it('should lint cleanly after ingesting a source', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.errorCount).toBe(0);
    });

    it('should detect orphan pages not in index', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      // Create an orphan page directly (not through ingest, so not indexed)
      await mkdir(join(tempDir, WIKI_DIR, 'wiki', 'entities'), { recursive: true });
      await writeFile(
        join(tempDir, WIKI_DIR, 'wiki', 'entities', 'orphan.md'),
        '---\ntype: entity\ntitle: Orphan\n---\n# Orphan\n',
        'utf-8',
      );

      const { stdout } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.warningCount).toBeGreaterThan(0);

      const orphanFinding = result.findings.find(
        (f: { category: string }) => f.category === 'orphan-pages',
      );
      expect(orphanFinding).toBeDefined();
      expect(orphanFinding.severity).toBe('warning');
    });

    it('should exit 1 when lint errors are found (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      // Create a page with a broken link
      await writeFile(
        join(tempDir, WIKI_DIR, 'wiki', 'sources', 'bad.md'),
        '---\ntype: source\ntitle: Bad\n---\n# Bad\n\nSee [missing](../does-not-exist.md)\n',
        'utf-8',
      );

      // Index this page so it's not orphan, but it has a broken link
      const indexPath = join(tempDir, WIKI_DIR, 'wiki', 'index.md');
      const indexContent = await readFile(indexPath, 'utf-8');
      await writeFile(
        indexPath,
        indexContent.replace(
          '## Sources',
          '## Sources\n\n- [Bad](sources/bad.md) — A bad source',
        ),
        'utf-8',
      );

      const { stdout, exitCode } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(1);
      const result = JSON.parse(stdout);
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('should support --category filter', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      // Create an orphan page
      await writeFile(
        join(tempDir, WIKI_DIR, 'wiki', 'sources', 'orphan.md'),
        '---\ntype: source\ntitle: Orphan\n---\n# Orphan\n',
        'utf-8',
      );

      // Run lint only for orphan-pages category
      const { stdout } = await runCLI(
        ['lint', '--path', tempDir, '--category', 'orphan-pages'],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      // All findings should be in the orphan-pages or index-completeness category
      // Since we filtered to orphan-pages only, no other categories should appear
      for (const finding of result.findings) {
        expect(finding.category).toBe('orphan-pages');
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // query
  // ────────────────────────────────────────────────────────────

  describe('query', () => {
    it('should return no results for empty wiki (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['query', 'neural', '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('No results found');
    });

    it('should return no results for empty wiki (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['query', 'neural', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.command).toBe('query');
      expect(result.query).toBe('neural');
      expect(result.matches).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should find ingested content (human-readable)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['query', 'sample', '--path', tempDir],
        tempDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('result(s)');
      expect(stdout).toContain('score:');
      expect(stdout).toContain('Path:');
    });

    it('should find ingested content (--json)', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout, exitCode } = await runCLI(
        ['query', 'sample', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.command).toBe('query');
      expect(result.matches).toBeGreaterThan(0);
      expect(result.results[0]).toHaveProperty('title');
      expect(result.results[0]).toHaveProperty('path');
      expect(result.results[0]).toHaveProperty('score');
      expect(result.results[0]).toHaveProperty('excerpt');
    });

    it('should save query results with --save', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      // Use a filename containing the query term so the index title matches
      const sourcePath = await createSampleSource(
        tempDir,
        'neural-networks.md',
        '# Neural Networks\n\nNeural networks are computing systems.\n',
      );
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout } = await runCLI(
        ['query', 'neural', '--path', tempDir, '--save'],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.matches).toBeGreaterThan(0);
      expect(result.saved).toBeDefined();
      expect(result.saved).toContain('queries/');

      // Verify the query page was actually written
      const queryPage = await readFile(
        join(tempDir, WIKI_DIR, 'wiki', result.saved),
        'utf-8',
      );
      expect(queryPage).toContain('type: query');
      expect(queryPage).toContain('neural');
    });

    it('should return no results for non-matching query', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);
      const sourcePath = await createSampleSource(tempDir);
      await runCLI(['ingest', sourcePath, '--path', tempDir], tempDir);

      const { stdout } = await runCLI(
        ['query', 'zzzznonexistent', '--path', tempDir],
        tempDir,
        true,
      );

      const result = JSON.parse(stdout);
      expect(result.matches).toBe(0);
      expect(result.results).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Full workflow
  // ────────────────────────────────────────────────────────────

  describe('full workflow', () => {
    it('init → ingest → status → lint → query (human-readable)', async () => {
      // 1. Init
      const initResult = await runCLI(['init', '--path', tempDir], tempDir);
      expect(initResult.exitCode).toBe(0);
      expect(initResult.stdout).toContain('Wiki initialized successfully');

      // 2. Create a source file & ingest
      const sourcePath = await createSampleSource(
        tempDir,
        'deep-learning.md',
        '# Deep Learning\n\nDeep learning is a subset of machine learning using neural network architectures with multiple layers.\n',
      );

      const ingestResult = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
      );
      // Copilot CLI not available — exits 1 but mechanical ingest succeeds
      expect(ingestResult.exitCode).toBe(1);
      expect(ingestResult.stdout).toContain('Source ingested');

      // 3. Status — should reflect the ingest
      const statusResult = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
      );
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stdout).toContain('Wiki Status');

      // 4. Lint — should be clean
      const lintResult = await runCLI(['lint', '--path', tempDir], tempDir);
      expect(lintResult.exitCode).toBe(0);
      expect(lintResult.stdout).toContain('No lint issues found');

      // 5. Query — should find the ingested content
      const queryResult = await runCLI(
        ['query', 'deep learning', '--path', tempDir],
        tempDir,
      );
      expect(queryResult.exitCode).toBe(0);
      expect(queryResult.stdout).toContain('result(s)');
    });

    it('init → ingest → status → lint → query (--json)', async () => {
      // 1. Init
      const { stdout: initOut } = await runCLI(
        ['init', '--path', tempDir],
        tempDir,
        true,
      );
      const init = JSON.parse(initOut);
      expect(init.api_version).toBe('1');
      expect(init.status).toBe('created');

      // 2. Ingest
      const sourcePath = await createSampleSource(
        tempDir,
        'transformers.md',
        '# Transformer Architecture\n\nTransformers use self-attention mechanisms for sequence-to-sequence tasks.\n',
      );

      const { stdout: ingestOut, exitCode: ingestExit } = await runCLI(
        ['ingest', sourcePath, '--path', tempDir],
        tempDir,
        true,
      );
      // Copilot CLI not available — exits 1 with error JSON
      expect(ingestExit).toBe(1);
      const ingest = JSON.parse(ingestOut);
      expect(ingest.code).toBe('NOT_INSTALLED');

      // 3. Status
      const { stdout: statusOut } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
        true,
      );
      const status = JSON.parse(statusOut);
      expect(status.api_version).toBe('1');
      expect(status.source_count).toBe(1);
      expect(status.wiki_page_count).toBe(1);
      expect(status.last_ingest_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(status.index_coverage_pct).toBe(100);

      // 4. Lint
      const { stdout: lintOut } = await runCLI(
        ['lint', '--path', tempDir],
        tempDir,
        true,
      );
      const lint = JSON.parse(lintOut);
      expect(lint.api_version).toBe('1');
      expect(lint.errorCount).toBe(0);

      // 5. Query
      const { stdout: queryOut } = await runCLI(
        ['query', 'transformer', '--path', tempDir],
        tempDir,
        true,
      );
      const query = JSON.parse(queryOut);
      expect(query.api_version).toBe('1');
      expect(query.matches).toBeGreaterThan(0);
      expect(query.results[0].title).toContain('transformers.md');
      expect(query.results[0].score).toBeGreaterThan(0);
      expect(query.results[0].excerpt).toContain('Transformer');
    });

    it('should handle multiple ingests correctly', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      // Ingest two different sources
      const source1 = await createSampleSource(
        tempDir,
        'alpha.md',
        '# Alpha Topic\n\nAlpha is the first item.\n',
      );
      const source2 = await createSampleSource(
        tempDir,
        'beta.md',
        '# Beta Topic\n\nBeta is the second item.\n',
      );

      await runCLI(['ingest', source1, '--path', tempDir], tempDir);
      await runCLI(['ingest', source2, '--path', tempDir], tempDir);

      // Status should reflect both
      const { stdout: statusOut } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
        true,
      );
      const status = JSON.parse(statusOut);
      expect(status.source_count).toBe(2);
      expect(status.wiki_page_count).toBe(2);

      // Query for each
      const { stdout: q1Out } = await runCLI(
        ['query', 'alpha', '--path', tempDir],
        tempDir,
        true,
      );
      expect(JSON.parse(q1Out).matches).toBeGreaterThan(0);

      const { stdout: q2Out } = await runCLI(
        ['query', 'beta', '--path', tempDir],
        tempDir,
        true,
      );
      expect(JSON.parse(q2Out).matches).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Error cases
  // ────────────────────────────────────────────────────────────

  describe('error cases', () => {
    it('should handle status on uninitialized wiki gracefully (--json)', async () => {
      const { stdout, exitCode } = await runCLI(
        ['status', '--path', tempDir],
        tempDir,
        true,
      );

      // status gracefully returns zeros, no crash
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.source_count).toBe(0);
      expect(result.wiki_page_count).toBe(0);
    });

    it('should handle query on uninitialized wiki gracefully (--json)', async () => {
      const { stdout, exitCode } = await runCLI(
        ['query', 'anything', '--path', tempDir],
        tempDir,
        true,
      );

      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.api_version).toBe('1');
      expect(result.matches).toBe(0);
    });

    it('should error when ingest is called without source argument', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stderr, exitCode } = await runCLI(
        ['ingest', '--path', tempDir],
        tempDir,
      );

      // Commander.js errors on missing required argument
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    it('should error when query is called without query argument', async () => {
      await runCLI(['init', '--path', tempDir], tempDir);

      const { stderr, exitCode } = await runCLI(
        ['query', '--path', tempDir],
        tempDir,
      );

      // Commander.js errors on missing required argument
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });
  });
});

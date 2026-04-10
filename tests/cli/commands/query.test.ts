import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePage } from '../../../packages/shared/src/wiki.js';
import { writeIndex } from '../../../packages/shared/src/index-ops.js';
import { readLog } from '../../../packages/shared/src/log.js';
import { createProgram } from '../../../packages/cli/src/cli.js';
import { queryWiki, slugifyQuery } from '../../../packages/cli/src/commands/query.js';

/**
 * Helper to set up a wiki with index and pages for search testing.
 */
async function setupTestWiki(root: string): Promise<void> {
  await mkdir(join(root, 'wiki', 'entities'), { recursive: true });
  await mkdir(join(root, 'wiki', 'concepts'), { recursive: true });
  await mkdir(join(root, 'wiki', 'sources'), { recursive: true });

  // Page 1: entity about machine learning
  await writePage(join(root, 'wiki', 'entities', 'neural-network.md'), {
    frontmatter: {
      type: 'entity',
      title: 'Neural Network',
      tags: ['ml', 'ai'],
      created: '2024-01-01',
    },
    body: 'A neural network is a machine learning model inspired by the brain. Neural networks learn patterns from data through training. Deep learning uses neural networks with many layers.',
  });

  // Page 2: concept about testing
  await writePage(join(root, 'wiki', 'concepts', 'unit-testing.md'), {
    frontmatter: {
      type: 'concept',
      title: 'Unit Testing',
      tags: ['testing', 'quality'],
      created: '2024-02-01',
    },
    body: 'Unit testing verifies individual components in isolation. Test-driven development writes tests before code. Testing is essential for software quality.',
  });

  // Page 3: source about TypeScript
  await writePage(join(root, 'wiki', 'sources', 'typescript-guide.md'), {
    frontmatter: {
      type: 'source',
      title: 'TypeScript Guide',
      tags: ['typescript', 'programming'],
      created: '2024-03-01',
    },
    body: 'TypeScript adds static types to JavaScript. TypeScript improves developer experience with better tooling. The TypeScript compiler checks types at build time.',
  });

  // Write index with all 3 entries
  await writeIndex(join(root, 'wiki', 'index.md'), [
    {
      path: 'entities/neural-network.md',
      title: 'Neural Network',
      summary: 'A machine learning model inspired by the brain',
      category: 'Entities',
      tags: ['ml', 'ai'],
    },
    {
      path: 'concepts/unit-testing.md',
      title: 'Unit Testing',
      summary: 'Verifying individual components in isolation',
      category: 'Concepts',
      tags: ['testing', 'quality'],
    },
    {
      path: 'sources/typescript-guide.md',
      title: 'TypeScript Guide',
      summary: 'A guide to TypeScript programming language',
      category: 'Sources',
      tags: ['typescript', 'programming'],
    },
  ]);
}

describe('queryWiki', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'query-test-'));
    await setupTestWiki(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should find pages matching a single query term', async () => {
    const result = await queryWiki('testing', tmpDir);

    expect(result.command).toBe('query');
    expect(result.query).toBe('testing');
    expect(result.matches).toBeGreaterThan(0);
    // "Unit Testing" should be a match (title + summary + body)
    const unitTestResult = result.results.find((r) => r.title === 'Unit Testing');
    expect(unitTestResult).toBeDefined();
    expect(unitTestResult!.score).toBeGreaterThan(0);
  });

  it('should rank pages with more matches higher', async () => {
    // "neural" appears in title (x3) and body (x1) of neural-network page
    // Other pages should score lower or zero for "neural"
    const result = await queryWiki('neural', tmpDir);

    expect(result.matches).toBeGreaterThanOrEqual(1);
    expect(result.results[0].title).toBe('Neural Network');
  });

  it('should weight title matches higher than summary matches', async () => {
    // "typescript" appears in title of TypeScript Guide (x3)
    // and in summary and body
    const result = await queryWiki('typescript', tmpDir);

    expect(result.matches).toBeGreaterThanOrEqual(1);
    expect(result.results[0].title).toBe('TypeScript Guide');
    // Title match (weight 3) should make this score higher
    expect(result.results[0].score).toBeGreaterThanOrEqual(3);
  });

  it('should return empty results for non-matching query', async () => {
    const result = await queryWiki('xylophone', tmpDir);

    expect(result.command).toBe('query');
    expect(result.query).toBe('xylophone');
    expect(result.matches).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('should handle multi-word queries', async () => {
    const result = await queryWiki('machine learning', tmpDir);

    expect(result.matches).toBeGreaterThan(0);
    // Neural Network page has "machine learning" in summary and body
    const neuralResult = result.results.find((r) => r.title === 'Neural Network');
    expect(neuralResult).toBeDefined();
  });

  it('should sort results by score descending', async () => {
    // Search for a term that matches multiple pages
    const result = await queryWiki('testing', tmpDir);

    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
    }
  });

  it('should include excerpt from body in results', async () => {
    const result = await queryWiki('neural', tmpDir);

    expect(result.results[0].excerpt).toBeDefined();
    expect(result.results[0].excerpt.length).toBeGreaterThan(0);
    expect(result.results[0].excerpt.length).toBeLessThanOrEqual(200);
  });

  it('should include path in results', async () => {
    const result = await queryWiki('typescript', tmpDir);

    const tsResult = result.results.find((r) => r.title === 'TypeScript Guide');
    expect(tsResult).toBeDefined();
    expect(tsResult!.path).toBe('sources/typescript-guide.md');
  });

  it('should handle empty wiki index gracefully', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'query-empty-'));
    try {
      await mkdir(join(emptyDir, 'wiki'), { recursive: true });
      await writeFile(join(emptyDir, 'wiki', 'index.md'), '# Wiki Index\n');

      const result = await queryWiki('anything', emptyDir);

      expect(result.matches).toBe(0);
      expect(result.results).toEqual([]);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('should be case-insensitive in matching', async () => {
    const result = await queryWiki('NEURAL', tmpDir);

    expect(result.matches).toBeGreaterThan(0);
    expect(result.results[0].title).toBe('Neural Network');
  });
});

describe('queryWiki --save', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'query-save-'));
    await setupTestWiki(tmpDir);
    // Create log.md so appendEntry can append to it
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should save query results to wiki/queries/ when --save is true', async () => {
    const result = await queryWiki('neural', tmpDir, true);

    expect(result.matches).toBeGreaterThan(0);

    // Check the queries directory was created and file exists
    const queryFile = join(tmpDir, 'wiki', 'queries', 'neural.md');
    const fileStat = await stat(queryFile);
    expect(fileStat.isFile()).toBe(true);

    const content = await readFile(queryFile, 'utf-8');
    expect(content).toContain('type: query');
    expect(content).toContain('neural');
  });

  it('should append to log when saving query results', async () => {
    await queryWiki('neural', tmpDir, true);

    const logEntries = await readLog(join(tmpDir, 'wiki', 'log.md'));
    const queryEntry = logEntries.find((e) => e.verb === 'queried');
    expect(queryEntry).toBeDefined();
    expect(queryEntry!.subject).toContain('neural');
  });

  it('should not save when --save is false', async () => {
    await queryWiki('neural', tmpDir, false);

    // queries directory should not exist
    try {
      await stat(join(tmpDir, 'wiki', 'queries', 'neural.md'));
      expect.fail('Query file should not exist');
    } catch {
      // Expected - file should not exist
    }
  });
});

describe('slugifyQuery', () => {
  it('should lowercase and replace spaces with hyphens', () => {
    expect(slugifyQuery('Hello World')).toBe('hello-world');
  });

  it('should replace non-alphanumeric characters with hyphens', () => {
    expect(slugifyQuery('test@#$%query!')).toBe('test-query');
  });

  it('should truncate to 50 characters', () => {
    const longQuery = 'a'.repeat(60);
    expect(slugifyQuery(longQuery).length).toBeLessThanOrEqual(50);
  });

  it('should handle mixed spaces and special chars', () => {
    expect(slugifyQuery('Machine Learning & AI')).toBe('machine-learning-ai');
  });

  it('should trim leading and trailing hyphens', () => {
    expect(slugifyQuery('  hello  ')).toBe('hello');
  });
});

describe('query CLI integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'query-cli-'));
    await setupTestWiki(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should register query command with required argument and options', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const query = wiki!.commands.find((cmd) => cmd.name() === 'query');
    expect(query).toBeDefined();
    expect(query!.description()).toContain('Search');

    const pathOption = query!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();

    const saveOption = query!.options.find((opt) => opt.long === '--save');
    expect(saveOption).toBeDefined();
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
        'query',
        'neural',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.command).toBe('query');
      expect(result.query).toBe('neural');
      expect(typeof result.matches).toBe('number');
      expect(Array.isArray(result.results)).toBe(true);
      if (result.matches > 0) {
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('path');
        expect(result.results[0]).toHaveProperty('score');
        expect(result.results[0]).toHaveProperty('excerpt');
      }
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-readable text by default', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'query',
        'neural',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('Found');
      expect(output).toContain('neural');
      expect(output).toContain('Neural Network');
    } finally {
      console.log = origLog;
    }
  });

  it('should output no-results message for non-matching query', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'query',
        'xylophone',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      expect(output).toContain('No results found');
      expect(output).toContain('xylophone');
    } finally {
      console.log = origLog;
    }
  });

  it('should output JSON with no results for non-matching query', async () => {
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
        'query',
        'xylophone',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]);
      expect(result.command).toBe('query');
      expect(result.matches).toBe(0);
      expect(result.results).toEqual([]);
    } finally {
      console.log = origLog;
    }
  });

  it('should save query results with --save flag via CLI', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'query',
        'neural',
        '--path',
        tmpDir,
        '--save',
      ]);

      // Verify saved file exists
      const queryFile = join(tmpDir, 'wiki', 'queries', 'neural.md');
      const fileStat = await stat(queryFile);
      expect(fileStat.isFile()).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});

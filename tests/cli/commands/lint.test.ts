import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lintWiki, LintResult, LintFinding } from '../../../packages/shared/src/lint.js';
import { writeIndex } from '../../../packages/shared/src/index-ops.js';
import { writePage } from '../../../packages/shared/src/wiki.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from '../../../packages/cli/src/cli.js';

describe('lintWiki', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return zero findings for a clean wiki', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Create a page that is indexed and has no broken links
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person', tags: ['test'], created: '2026-04-10' },
      body: 'A person page with no links.',
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

    const result = await lintWiki(tmpDir);

    expect(result.command).toBe('lint');
    expect(result.findings).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(0);
  });

  it('should detect broken links', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [nonexistent](../concepts/nonexistent.md) for more.',
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

    const result = await lintWiki(tmpDir);

    const brokenLinks = result.findings.filter(
      (f) => f.category === 'broken-links',
    );
    expect(brokenLinks.length).toBeGreaterThanOrEqual(1);
    expect(brokenLinks[0].severity).toBe('error');
    expect(brokenLinks[0].file).toContain('person.md');
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('should detect orphan pages', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    // person.md is indexed, orphan.md is NOT indexed and NOT linked
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A person page.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'orphan.md'), {
      frontmatter: { type: 'concept', title: 'Orphan' },
      body: 'Nobody links here.',
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

    const result = await lintWiki(tmpDir);

    const orphans = result.findings.filter(
      (f) => f.category === 'orphan-pages',
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].severity).toBe('warning');
    expect(orphans[0].message).toContain('orphan.md');
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
  });

  it('should not flag a page as orphan if it is linked from another page', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    // person.md links to idea.md, idea.md is NOT in index but is linked
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [idea](../concepts/idea.md) for more.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'idea.md'), {
      frontmatter: { type: 'concept', title: 'Idea' },
      body: 'An idea page.',
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

    const result = await lintWiki(tmpDir);

    const orphans = result.findings.filter(
      (f) => f.category === 'orphan-pages',
    );
    expect(orphans).toHaveLength(0);
  });

  it('should detect index-completeness issues', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Page exists but is NOT in index
    await writePage(join(tmpDir, 'wiki', 'entities', 'missing.md'), {
      frontmatter: { type: 'entity', title: 'Missing' },
      body: 'Not in index.',
    });

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintWiki(tmpDir);

    const completeness = result.findings.filter(
      (f) => f.category === 'index-completeness',
    );
    expect(completeness.length).toBe(1);
    expect(completeness[0].severity).toBe('warning');
    expect(completeness[0].message).toContain('missing.md');
  });

  it('should detect stale entries', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Index references a file that doesn't exist
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/ghost.md',
        title: 'Ghost',
        summary: 'Does not exist',
        category: 'Entities',
        tags: [],
      },
    ]);

    const result = await lintWiki(tmpDir);

    const stale = result.findings.filter(
      (f) => f.category === 'stale-entries',
    );
    expect(stale.length).toBe(1);
    expect(stale[0].severity).toBe('error');
    expect(stale[0].message).toContain('ghost.md');
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('should detect missing-pages as info findings', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [gone](../concepts/gone.md) and [also gone](../concepts/gone.md).',
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

    const result = await lintWiki(tmpDir);

    const missing = result.findings.filter(
      (f) => f.category === 'missing-pages',
    );
    // missing-pages reports unique missing targets (deduped)
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe('info');
    expect(missing[0].message).toContain('gone.md');
    expect(result.infoCount).toBeGreaterThanOrEqual(1);
  });

  it('should filter by category when categories are provided', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Create a broken link AND a stale entry — but only ask for broken-links
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [missing](../concepts/missing.md).',
    });

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/person.md',
        title: 'Person',
        summary: 'A person',
        category: 'Entities',
        tags: [],
      },
      {
        path: 'entities/ghost.md',
        title: 'Ghost',
        summary: 'Stale',
        category: 'Entities',
        tags: [],
      },
    ]);

    const result = await lintWiki(tmpDir, ['broken-links']);

    // Only broken-links findings should be present
    const categories = new Set(result.findings.map((f) => f.category));
    expect(categories.has('stale-entries')).toBe(false);
    expect(categories.has('broken-links')).toBe(true);
  });

  it('should handle empty/uninitialized wiki gracefully', async () => {
    // tmpDir has no wiki/ directory at all
    const result = await lintWiki(tmpDir);

    expect(result.command).toBe('lint');
    expect(result.findings).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(0);
  });

  it('should handle wiki with only index.md and log.md', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');
    await writeFile(join(tmpDir, 'wiki', 'log.md'), '');

    const result = await lintWiki(tmpDir);

    expect(result.command).toBe('lint');
    expect(result.findings).toHaveLength(0);
  });
});

describe('lint CLI integration', () => {
  let tmpDir: string;
  let origExitCode: number | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-cli-test-'));
    origExitCode = process.exitCode;
  });

  afterEach(async () => {
    process.exitCode = origExitCode;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should register lint command with --path and --category options', () => {
    const program = createProgram();
    const wiki = program.commands.find((cmd) => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const lint = wiki!.commands.find((cmd) => cmd.name() === 'lint');
    expect(lint).toBeDefined();

    const pathOption = lint!.options.find((opt) => opt.long === '--path');
    expect(pathOption).toBeDefined();

    const categoryOption = lint!.options.find(
      (opt) => opt.long === '--category',
    );
    expect(categoryOption).toBeDefined();
  });

  it('should output JSON when --json flag is set', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
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
        'lint',
        '--path',
        tmpDir,
      ]);

      expect(logs).toHaveLength(1);
      const result = JSON.parse(logs[0]) as LintResult;
      expect(result.command).toBe('lint');
      expect(result.findings).toBeDefined();
      expect(typeof result.errorCount).toBe('number');
      expect(typeof result.warningCount).toBe('number');
      expect(typeof result.infoCount).toBe('number');
    } finally {
      console.log = origLog;
    }
  });

  it('should output human-readable text with severity symbols', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Create a broken link to generate an error finding
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [missing](../concepts/missing.md).',
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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'lint',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      // Should contain error symbol
      expect(output).toContain('✗');
    } finally {
      console.log = origLog;
    }
  });

  it('should set process.exitCode = 1 when errors exist', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [missing](../concepts/missing.md).',
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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'lint',
        '--path',
        tmpDir,
      ]);

      expect(process.exitCode).toBe(1);
    } finally {
      console.log = origLog;
    }
  });

  it('should not set process.exitCode = 1 when no errors exist', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'A clean page.',
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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'plaid',
        'wiki',
        'lint',
        '--path',
        tmpDir,
      ]);

      expect(process.exitCode).not.toBe(1);
    } finally {
      console.log = origLog;
    }
  });

  it('should support --category filter via CLI', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Broken link + stale entry, filter only broken-links
    await writePage(join(tmpDir, 'wiki', 'entities', 'person.md'), {
      frontmatter: { type: 'entity', title: 'Person' },
      body: 'See [missing](../concepts/missing.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      {
        path: 'entities/person.md',
        title: 'Person',
        summary: 'A person',
        category: 'Entities',
        tags: [],
      },
      {
        path: 'entities/ghost.md',
        title: 'Ghost',
        summary: 'Stale',
        category: 'Entities',
        tags: [],
      },
    ]);

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
        'lint',
        '--path',
        tmpDir,
        '--category',
        'broken-links',
      ]);

      const result = JSON.parse(logs[0]) as LintResult;
      const categories = new Set(result.findings.map((f: LintFinding) => f.category));
      expect(categories.has('stale-entries')).toBe(false);
    } finally {
      console.log = origLog;
    }
  });

  it('should output summary line in human-readable mode', async () => {
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
        'lint',
        '--path',
        tmpDir,
      ]);

      const output = logs.join('\n');
      // Clean wiki shows no-issues message
      expect(output).toContain('No lint issues found');
    } finally {
      console.log = origLog;
    }
  });
});

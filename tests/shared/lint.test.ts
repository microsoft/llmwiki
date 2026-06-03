import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lintWiki } from '../../packages/core/src/lint.js';
import { writeIndex } from '../../packages/core/src/index-ops.js';
import { writePage } from '../../packages/core/src/wiki.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('lintWiki — broken-links', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-bl-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no broken-link findings when all links are valid', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [beta](../concepts/beta.md) for details.',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'beta.md'), {
      frontmatter: { type: 'concept', title: 'Beta', tags: ['test'], created: '2026-01-01' },
      body: 'Related to alpha.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
      { path: 'concepts/beta.md', title: 'Beta', summary: 'B', category: 'Concepts', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['broken-links']);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect a single broken link', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [ghost](../concepts/ghost.md) for more.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['broken-links']);
    const findings = result.findings.filter((f) => f.category === 'broken-links');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('ghost.md');
    expect(findings[0].file).toContain('alpha.md');
  });

  it('should detect multiple broken links in one page', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [a](../concepts/a.md) and [b](../concepts/b.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['broken-links']);
    const findings = result.findings.filter((f) => f.category === 'broken-links');
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('should ignore external http/https links', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'ext.md'), {
      frontmatter: { type: 'entity', title: 'External', tags: ['test'], created: '2026-01-01' },
      body: 'See [docs](https://example.com/page.md) and [other](http://example.com/file.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/ext.md', title: 'External', summary: 'E', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['broken-links']);
    expect(result.findings).toHaveLength(0);
  });
});

describe('lintWiki — orphan-pages', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-op-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no orphans when all pages are indexed', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'Indexed page.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['orphan-pages']);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect a page not indexed and not linked', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'orphan.md'), {
      frontmatter: { type: 'entity', title: 'Orphan', tags: ['test'], created: '2026-01-01' },
      body: 'Nobody references me.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintWiki(tmpDir, ['orphan-pages']);
    const findings = result.findings.filter((f) => f.category === 'orphan-pages');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('orphan.md');
  });

  it('should NOT flag a page as orphan if it has an inbound link', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [linked](../concepts/linked.md).',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'linked.md'), {
      frontmatter: { type: 'concept', title: 'Linked', tags: ['test'], created: '2026-01-01' },
      body: 'Linked from alpha.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['orphan-pages']);
    const findings = result.findings.filter((f) => f.category === 'orphan-pages');
    expect(findings).toHaveLength(0);
  });
});

describe('lintWiki — index-completeness', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-ic-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no findings when all pages are in the index', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'Indexed.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['index-completeness']);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect a page missing from the index', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'unlisted.md'), {
      frontmatter: { type: 'entity', title: 'Unlisted', tags: ['test'], created: '2026-01-01' },
      body: 'Not in index.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintWiki(tmpDir, ['index-completeness']);
    const findings = result.findings.filter((f) => f.category === 'index-completeness');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('unlisted.md');
  });

  it('should detect multiple pages missing from the index', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'x.md'), {
      frontmatter: { type: 'entity', title: 'X', tags: ['t'], created: '2026-01-01' },
      body: '',
    });
    await writePage(join(tmpDir, 'wiki', 'entities', 'y.md'), {
      frontmatter: { type: 'entity', title: 'Y', tags: ['t'], created: '2026-01-01' },
      body: '',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintWiki(tmpDir, ['index-completeness']);
    const findings = result.findings.filter((f) => f.category === 'index-completeness');
    expect(findings).toHaveLength(2);
    findings.forEach((f) => expect(f.severity).toBe('warning'));
  });
});

describe('lintWiki — stale-entries', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-se-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no findings when all index entries have files', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'Exists.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['stale-entries']);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect an index entry pointing to a deleted file', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/deleted.md', title: 'Deleted', summary: 'Gone', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['stale-entries']);
    const findings = result.findings.filter((f) => f.category === 'stale-entries');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('deleted.md');
  });
});

describe('lintWiki — missing-pages', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-mp-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no missing-pages when all links resolve', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [beta](../concepts/beta.md).',
    });
    await writePage(join(tmpDir, 'wiki', 'concepts', 'beta.md'), {
      frontmatter: { type: 'concept', title: 'Beta', tags: ['test'], created: '2026-01-01' },
      body: 'Exists.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
      { path: 'concepts/beta.md', title: 'Beta', summary: 'B', category: 'Concepts', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['missing-pages']);
    expect(result.findings).toHaveLength(0);
  });

  it('should deduplicate missing page targets across multiple references', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [x](../concepts/x.md) and again [x](../concepts/x.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['missing-pages']);
    const findings = result.findings.filter((f) => f.category === 'missing-pages');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });

  it('should report distinct missing pages from different link targets', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [a](../concepts/a.md) and [b](../concepts/b.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['missing-pages']);
    const findings = result.findings.filter((f) => f.category === 'missing-pages');
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('lintWiki — frontmatter-validation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-fv-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should report no findings for page with all required and recommended fields', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'complete.md'), {
      frontmatter: { type: 'entity', title: 'Complete', tags: ['test'], created: '2026-01-01' },
      body: 'All fields present.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/complete.md', title: 'Complete', summary: 'C', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect missing type field as error', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'notype.md'), {
      frontmatter: { title: 'No Type', tags: ['test'], created: '2026-01-01' },
      body: 'Missing type.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/notype.md', title: 'No Type', summary: 'N', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    const findings = result.findings.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('type'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('should detect missing title field as error', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'notitle.md'), {
      frontmatter: { type: 'entity', tags: ['test'], created: '2026-01-01' },
      body: 'Missing title.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/notitle.md', title: 'No Title', summary: 'N', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    const findings = result.findings.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('title'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('should detect invalid type value as warning', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'badtype.md'), {
      frontmatter: { type: 'invalid-type', title: 'Bad Type', tags: ['test'], created: '2026-01-01' },
      body: 'Invalid type value.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/badtype.md', title: 'Bad Type', summary: 'B', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    const findings = result.findings.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('invalid-type'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('should detect missing tags and created as info findings', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'sparse.md'), {
      frontmatter: { type: 'entity', title: 'Sparse' },
      body: 'No tags or created.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/sparse.md', title: 'Sparse', summary: 'S', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    const findings = result.findings.filter(
      (f) => f.category === 'frontmatter-validation' && f.severity === 'info',
    );
    expect(findings).toHaveLength(2);
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes('tags'))).toBe(true);
    expect(messages.some((m) => m.includes('created'))).toBe(true);
  });

  it('should accept all valid page types without warning', async () => {
    await mkdir(join(tmpDir, 'wiki', 'pages'), { recursive: true });
    const validTypes = ['entity', 'concept', 'source', 'summary', 'query'];

    for (const pageType of validTypes) {
      await writePage(join(tmpDir, 'wiki', 'pages', `${pageType}.md`), {
        frontmatter: { type: pageType, title: `Page ${pageType}`, tags: ['test'], created: '2026-01-01' },
        body: `A ${pageType} page.`,
      });
    }

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), validTypes.map((t) => ({
      path: `pages/${t}.md`, title: `Page ${t}`, summary: t, category: 'Pages', tags: [],
    })));

    const result = await lintWiki(tmpDir, ['frontmatter-validation']);
    expect(result.findings).toHaveLength(0);
  });
});

describe('lintWiki — edge cases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-edge-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should handle empty wiki directory gracefully', async () => {
    const result = await lintWiki(tmpDir);
    expect(result.command).toBe('lint');
    expect(result.findings).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(0);
  });

  it('should handle wiki with only index.md and no pages', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await writeFile(join(tmpDir, 'wiki', 'index.md'), '# Wiki Index\n');

    const result = await lintWiki(tmpDir);
    expect(result.findings).toHaveLength(0);
  });

  it('should only run specified category when filter is provided', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Setup that would trigger findings in multiple categories
    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha' },
      body: 'See [ghost](../concepts/ghost.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
      { path: 'entities/deleted.md', title: 'Deleted', summary: 'D', category: 'Entities', tags: [] },
    ]);

    // Only run stale-entries
    const result = await lintWiki(tmpDir, ['stale-entries']);
    const categories = new Set(result.findings.map((f) => f.category));
    expect(categories.size).toBe(1);
    expect(categories.has('stale-entries')).toBe(true);
  });

  it('should populate categorySummary correctly', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha' },
      body: 'See [a](../concepts/a.md) and [b](../concepts/b.md).',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintWiki(tmpDir);
    expect(result.categorySummary['broken-links']).toBe(2);
    expect(result.categorySummary['missing-pages']).toBe(2);
    // Verify error/warning/info counts match
    expect(result.errorCount).toBe(result.findings.filter((f) => f.severity === 'error').length);
    expect(result.warningCount).toBe(result.findings.filter((f) => f.severity === 'warning').length);
    expect(result.infoCount).toBe(result.findings.filter((f) => f.severity === 'info').length);
  });
});

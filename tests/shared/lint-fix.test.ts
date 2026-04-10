import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lintFix } from '../../packages/shared/src/lint.js';
import { lintWiki } from '../../packages/shared/src/lint.js';
import { writeIndex, readIndex } from '../../packages/shared/src/index-ops.js';
import { writePage, readPage } from '../../packages/shared/src/wiki.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('lintFix — stale-entries', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-se-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should remove stale index entries pointing to deleted files', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Create one real page and one stale index entry
    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'Exists.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
      { path: 'entities/deleted.md', title: 'Deleted', summary: 'Gone', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    expect(result.fixedCount).toBeGreaterThanOrEqual(1);
    const staleFixed = result.fixed.filter((f) => f.category === 'stale-entries');
    expect(staleFixed).toHaveLength(1);
    expect(staleFixed[0].file).toBe('entities/deleted.md');

    // Verify the stale entry was actually removed from the index
    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('entities/alpha.md');
  });

  it('should remove multiple stale entries', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });

    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/gone1.md', title: 'Gone1', summary: '', category: 'Entities', tags: [] },
      { path: 'entities/gone2.md', title: 'Gone2', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const staleFixed = result.fixed.filter((f) => f.category === 'stale-entries');
    expect(staleFixed).toHaveLength(2);

    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries).toHaveLength(0);
  });
});

describe('lintFix — index-completeness', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-ic-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should add missing pages to the index', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'unlisted.md'), {
      frontmatter: { type: 'entity', title: 'Unlisted Entity', tags: ['auto'], created: '2026-01-01' },
      body: 'Not in index.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir);

    const icFixed = result.fixed.filter((f) => f.category === 'index-completeness');
    expect(icFixed).toHaveLength(1);

    // Verify the page was actually added to the index
    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Unlisted Entity');
    expect(entries[0].path).toBe('entities/unlisted.md');
    expect(entries[0].tags).toEqual(['auto']);
  });

  it('should derive title from frontmatter when available', async () => {
    await mkdir(join(tmpDir, 'wiki', 'concepts'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'concepts', 'my-concept.md'), {
      frontmatter: { type: 'concept', title: 'My Custom Title', tags: [], created: '2026-01-01' },
      body: 'Has a custom title.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir);

    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries[0].title).toBe('My Custom Title');
  });

  it('should derive title from path when frontmatter title is missing', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'cool-topic.md'), {
      frontmatter: { type: 'entity', tags: ['t'], created: '2026-01-01' },
      body: 'No title.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir);

    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    expect(entries.some((e) => e.title === 'Cool Topic')).toBe(true);
  });
});

describe('lintFix — frontmatter-validation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-fv-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should add default type when missing', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'notype.md'), {
      frontmatter: { title: 'NoType', tags: ['test'], created: '2026-01-01' },
      body: 'Missing type.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/notype.md', title: 'NoType', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const typeFixed = result.fixed.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('"type"'),
    );
    expect(typeFixed).toHaveLength(1);

    const page = await readPage(join(tmpDir, 'wiki', 'entities', 'notype.md'));
    expect(page.frontmatter.type).toBe('entity');
  });

  it('should add default title when missing', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'no-title.md'), {
      frontmatter: { type: 'entity', tags: ['test'], created: '2026-01-01' },
      body: 'Missing title.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/no-title.md', title: 'NoTitle', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const titleFixed = result.fixed.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('"title"'),
    );
    expect(titleFixed).toHaveLength(1);

    const page = await readPage(join(tmpDir, 'wiki', 'entities', 'no-title.md'));
    expect(page.frontmatter.title).toBe('No Title');
  });

  it('should add default tags when missing', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'notags.md'), {
      frontmatter: { type: 'entity', title: 'NoTags', created: '2026-01-01' },
      body: 'Missing tags.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/notags.md', title: 'NoTags', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const tagsFixed = result.fixed.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('"tags"'),
    );
    expect(tagsFixed).toHaveLength(1);

    const page = await readPage(join(tmpDir, 'wiki', 'entities', 'notags.md'));
    expect(page.frontmatter.tags).toEqual([]);
  });

  it('should add default created date when missing', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'nodate.md'), {
      frontmatter: { type: 'entity', title: 'NoDate', tags: ['test'] },
      body: 'Missing created.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/nodate.md', title: 'NoDate', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const createdFixed = result.fixed.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('"created"'),
    );
    expect(createdFixed).toHaveLength(1);

    const page = await readPage(join(tmpDir, 'wiki', 'entities', 'nodate.md'));
    expect(page.frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should NOT auto-fix invalid type values', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'badtype.md'), {
      frontmatter: { type: 'invalid_type', title: 'BadType', tags: ['test'], created: '2026-01-01' },
      body: 'Invalid type.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/badtype.md', title: 'BadType', summary: '', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const typeRemaining = result.remaining.filter(
      (f) => f.category === 'frontmatter-validation' && f.message.includes('Invalid type'),
    );
    expect(typeRemaining).toHaveLength(1);
    expect(result.fixed.filter((f) => f.message.includes('Invalid type'))).toHaveLength(0);
  });
});

describe('lintFix — orphan-pages', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-op-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should NOT fix orphan pages by default', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'orphan.md'), {
      frontmatter: { type: 'entity', title: 'Orphan', tags: ['test'], created: '2026-01-01' },
      body: 'Nobody links to me.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir);

    const orphanFixed = result.fixed.filter((f) => f.category === 'orphan-pages');
    expect(orphanFixed).toHaveLength(0);

    const orphanRemaining = result.remaining.filter((f) => f.category === 'orphan-pages');
    expect(orphanRemaining).toHaveLength(1);
  });

  it('should fix orphan pages when fixOrphans is true', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'orphan.md'), {
      frontmatter: { type: 'entity', title: 'Orphan Page', tags: ['auto'], created: '2026-01-01' },
      body: 'Nobody links to me.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir, { fixOrphans: true });

    const orphanFixed = result.fixed.filter((f) => f.category === 'orphan-pages');
    expect(orphanFixed).toHaveLength(1);

    // Verify the orphan was added to the index
    const entries = await readIndex(join(tmpDir, 'wiki', 'index.md'));
    const orphanEntry = entries.find((e) => e.path === 'entities/orphan.md');
    expect(orphanEntry).toBeDefined();
    expect(orphanEntry!.title).toBe('Orphan Page');
  });
});

describe('lintFix — broken-links remain unfixed', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-bl-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should leave broken-links in remaining (not auto-fixed)', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'alpha.md'), {
      frontmatter: { type: 'entity', title: 'Alpha', tags: ['test'], created: '2026-01-01' },
      body: 'See [ghost](../concepts/ghost.md) for more.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/alpha.md', title: 'Alpha', summary: 'A', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    const brokenFixed = result.fixed.filter((f) => f.category === 'broken-links');
    expect(brokenFixed).toHaveLength(0);

    const brokenRemaining = result.remaining.filter((f) => f.category === 'broken-links');
    expect(brokenRemaining).toHaveLength(1);
  });
});

describe('lintFix — result structure', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lintfix-rs-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return correct result structure with command and api_version', async () => {
    await mkdir(join(tmpDir, 'wiki'), { recursive: true });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), []);

    const result = await lintFix(tmpDir);

    expect(result.command).toBe('lint-fix');
    expect(result.api_version).toBeDefined();
    expect(typeof result.api_version).toBe('string');
    expect(Array.isArray(result.fixed)).toBe(true);
    expect(Array.isArray(result.remaining)).toBe(true);
    expect(typeof result.fixedCount).toBe('number');
    expect(result.fixedCount).toBe(result.fixed.length);
  });

  it('should return empty fixed and remaining when wiki is clean', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    await writePage(join(tmpDir, 'wiki', 'entities', 'perfect.md'), {
      frontmatter: { type: 'entity', title: 'Perfect', tags: ['test'], created: '2026-01-01' },
      body: 'All good.',
    });
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/perfect.md', title: 'Perfect', summary: 'P', category: 'Entities', tags: [] },
    ]);

    const result = await lintFix(tmpDir);

    expect(result.fixedCount).toBe(0);
    expect(result.fixed).toHaveLength(0);
    expect(result.remaining).toHaveLength(0);
  });

  it('should verify that fixes actually resolve the lint findings', async () => {
    await mkdir(join(tmpDir, 'wiki', 'entities'), { recursive: true });

    // Create a page missing from index with incomplete frontmatter
    await writePage(join(tmpDir, 'wiki', 'entities', 'messy.md'), {
      frontmatter: { type: 'entity' },
      body: 'Messy page.',
    });
    // Stale index entry
    await writeIndex(join(tmpDir, 'wiki', 'index.md'), [
      { path: 'entities/stale.md', title: 'Stale', summary: '', category: 'Entities', tags: [] },
    ]);

    // Fix issues
    await lintFix(tmpDir);

    // Re-lint to verify fixes are effective
    const recheck = await lintWiki(tmpDir);
    const staleFindings = recheck.findings.filter((f) => f.category === 'stale-entries');
    expect(staleFindings).toHaveLength(0);

    const icFindings = recheck.findings.filter((f) => f.category === 'index-completeness');
    expect(icFindings).toHaveLength(0);

    // Title and tags should have been fixed
    const fmFindings = recheck.findings.filter(
      (f) => f.category === 'frontmatter-validation' && f.file === 'entities/messy.md',
    );
    const missingTitle = fmFindings.filter((f) => f.message.includes('"title"'));
    expect(missingTitle).toHaveLength(0);
    const missingTags = fmFindings.filter((f) => f.message.includes('"tags"'));
    expect(missingTags).toHaveLength(0);
  });
});

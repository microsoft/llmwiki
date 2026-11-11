import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixWiki, findOrphanedDerivedPages, normalizeSourceRef, removeSourcePages } from '../../packages/core/src/fix.js';
import { lintFix, type LintFinding } from '../../packages/core/src/lint.js';
import { writePage } from '../../packages/core/src/wiki.js';
import { writeIndex, readIndex } from '../../packages/core/src/index-ops.js';
import { readLog } from '../../packages/core/src/log.js';

let root: string;
let wikiDir: string;

async function page(relPath: string, frontmatter: Record<string, unknown>, body = 'Body.') {
  await writePage(join(wikiDir, relPath), { frontmatter, body });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fixwiki-'));
  wikiDir = join(root, 'wiki');
  await mkdir(join(wikiDir, 'entities'), { recursive: true });
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'sources'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findOrphanedDerivedPages', () => {
  it('returns entity/concept pages whose sources are all missing', async () => {
    await page('sources/kept-summary.md', { type: 'summary', title: 'Kept' });
    await page('entities/gone.md', { type: 'entity', title: 'Gone', sources: ['sources/removed-summary.md'] });
    await page('concepts/kept.md', { type: 'concept', title: 'Kept', sources: ['sources/kept-summary.md'] });
    await page('concepts/mixed.md', {
      type: 'concept',
      title: 'Mixed',
      sources: ['sources/removed-summary.md', 'sources/kept-summary.md'],
    });
    await page('concepts/no-sources.md', { type: 'concept', title: 'No sources' });

    expect(await findOrphanedDerivedPages(wikiDir)).toEqual(['entities/gone.md']);
  });

  it('never treats malformed sources as missing', async () => {
    await page('entities/odd.md', { type: 'entity', title: 'Odd', sources: [42, ''] });
    expect(await findOrphanedDerivedPages(wikiDir)).toEqual([]);
  });

  it('ignores sources that are not summary pages (raw paths, URLs)', async () => {
    await page('entities/raw-ref.md', { type: 'entity', title: 'Raw ref', sources: ['raw/paper.pdf'] });
    await page('entities/url-ref.md', { type: 'entity', title: 'URL ref', sources: ['https://arxiv.org/abs/1706.03762'] });
    await page('concepts/mixed-ref.md', {
      type: 'concept',
      title: 'Mixed ref',
      sources: ['sources/gone-summary.md', 'raw/notes.md'],
    });
    expect(await findOrphanedDerivedPages(wikiDir)).toEqual([]);
  });

  it('returns an empty list when the wiki directory does not exist', async () => {
    expect(await findOrphanedDerivedPages(join(root, 'missing'))).toEqual([]);
  });
});

describe('normalizeSourceRef', () => {
  it.each([
    ['sources/a-summary.md', 'sources/a-summary.md'],
    ['./sources/a-summary.md', 'sources/a-summary.md'],
    ['sources\\a-summary.md', 'sources/a-summary.md'],
    ['  sources/nested/b-summary.md ', 'sources/nested/b-summary.md'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeSourceRef(input)).toBe(expected);
  });

  it.each([
    'raw/paper.pdf',
    'https://example.com/sources/a.md',
    'concepts/ai.md',
    'sources/../concepts/ai.md',
    'sources//a.md',
    'sources/a-summary.txt',
    '',
    42,
    undefined,
  ])('rejects %j', (input) => {
    expect(normalizeSourceRef(input)).toBeUndefined();
  });
});

describe('removeSourcePages', () => {
  beforeEach(async () => {
    await page('sources/a-summary.md', { type: 'summary', title: 'A' });
    await page('sources/b-summary.md', { type: 'summary', title: 'B' });
    await page('entities/only-a.md', { type: 'entity', title: 'Only A', sources: ['sources/a-summary.md'] });
    await page('concepts/a-and-b.md', {
      type: 'concept',
      title: 'A and B',
      sources: ['sources/a-summary.md', 'sources/b-summary.md'],
    });
    await page('concepts/only-b.md', { type: 'concept', title: 'Only B', sources: ['sources/b-summary.md'] });
    await page('concepts/hand-written.md', { type: 'concept', title: 'Hand-written' });
    await writeIndex(join(wikiDir, 'index.md'), [
      { path: 'entities/only-a.md', title: 'Only A', summary: '', category: 'Entities', tags: [] },
      { path: 'concepts/a-and-b.md', title: 'A and B', summary: '', category: 'Concepts', tags: [] },
    ]);
  });

  it('deletes the summary and the pages with no other remaining source', async () => {
    const removed = await removeSourcePages(wikiDir, 'sources/a-summary.md');

    expect(removed.sort()).toEqual(['entities/only-a.md', 'sources/a-summary.md']);
    expect(existsSync(join(wikiDir, 'entities', 'only-a.md'))).toBe(false);
    expect(existsSync(join(wikiDir, 'concepts', 'a-and-b.md'))).toBe(true);
    expect(existsSync(join(wikiDir, 'concepts', 'only-b.md'))).toBe(true);
    expect(existsSync(join(wikiDir, 'concepts', 'hand-written.md'))).toBe(true);
    const paths = (await readIndex(join(wikiDir, 'index.md'))).map((e) => e.path);
    expect(paths).toEqual(['concepts/a-and-b.md']);
  });

  it('deletes a multi-source page once its last source is removed', async () => {
    await removeSourcePages(wikiDir, 'sources/a-summary.md');
    const removed = await removeSourcePages(wikiDir, 'sources/b-summary.md');

    expect(removed.sort()).toEqual(['concepts/a-and-b.md', 'concepts/only-b.md', 'sources/b-summary.md']);
    expect(existsSync(join(wikiDir, 'concepts', 'hand-written.md'))).toBe(true);
  });

  it('still cleans up derived pages when the summary was never written', async () => {
    await rm(join(wikiDir, 'sources', 'a-summary.md'));
    expect(await removeSourcePages(wikiDir, 'sources/a-summary.md')).toEqual(['entities/only-a.md']);
  });

  it('returns nothing for an unknown source', async () => {
    expect(await removeSourcePages(wikiDir, 'sources/unknown-summary.md')).toEqual([]);
  });

  it('matches sources written with a leading ./', async () => {
    await page('concepts/dotted.md', { type: 'concept', title: 'Dotted', sources: ['./sources/a-summary.md'] });
    expect(await removeSourcePages(wikiDir, 'sources/a-summary.md')).toContain('concepts/dotted.md');
  });
});

describe('fixWiki', () => {
  async function seedBrokenWiki() {
    await page('entities/gone.md', { type: 'entity', title: 'Gone', sources: ['sources/removed-summary.md'] });
    await page('concepts/unindexed.md', { type: 'concept', title: 'Unindexed', tags: [], created: '2026-01-01' });
    await page('concepts/linked.md', { type: 'concept', title: 'Linked', tags: [], created: '2026-01-01' }, 'See [missing](missing.md).');
    await writeIndex(join(wikiDir, 'index.md'), [
      { path: 'entities/gone.md', title: 'Gone', summary: '', category: 'Entities', tags: [] },
      { path: 'concepts/linked.md', title: 'Linked', summary: '', category: 'Concepts', tags: [] },
      { path: 'concepts/deleted.md', title: 'Deleted', summary: '', category: 'Concepts', tags: [] },
    ]);
  }

  it('removes orphaned derived pages, applies lint fixes and reports the rest', async () => {
    await seedBrokenWiki();

    const result = await fixWiki(root);

    expect(result.command).toBe('fix');
    expect(result.dry_run).toBe(false);
    expect(result.removed_pages).toEqual(['entities/gone.md']);
    expect(existsSync(join(wikiDir, 'entities', 'gone.md'))).toBe(false);

    const categories = result.fixed.map((f) => f.category);
    expect(categories).toContain('stale-entries');
    expect(categories).toContain('index-completeness');
    expect(result.fixedCount).toBe(result.fixed.length);

    expect(result.remaining.some((f) => f.category === 'broken-links')).toBe(true);
    expect(result.remainingCount).toBe(result.remaining.length);

    const paths = (await readIndex(join(wikiDir, 'index.md'))).map((e) => e.path).sort();
    expect(paths).toEqual(['concepts/linked.md', 'concepts/unindexed.md']);
  });

  it('logs a lint-fix entry when it changes something', async () => {
    await seedBrokenWiki();
    await fixWiki(root);

    const log = await readLog(join(wikiDir, 'log.md'));
    expect(log.at(-1)?.verb).toBe('lint-fix');
    expect(log.at(-1)?.details).toContain('Removed 1 orphaned page(s)');
  });

  it('does not log when there is nothing to fix', async () => {
    await page('concepts/a.md', { type: 'concept', title: 'A', tags: [], created: '2026-01-01' });
    await writeIndex(join(wikiDir, 'index.md'), [
      { path: 'concepts/a.md', title: 'A', summary: '', category: 'Concepts', tags: [] },
    ]);

    const result = await fixWiki(root);

    expect(result.fixedCount).toBe(0);
    expect(result.removed_pages).toEqual([]);
    expect(existsSync(join(wikiDir, 'log.md'))).toBe(false);
  });

  it('changes nothing in dry-run mode but reports the same plan', async () => {
    await seedBrokenWiki();
    const indexBefore = await readFile(join(wikiDir, 'index.md'), 'utf-8');

    const result = await fixWiki(root, { dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.removed_pages).toEqual(['entities/gone.md']);
    expect(existsSync(join(wikiDir, 'entities', 'gone.md'))).toBe(true);
    expect(await readFile(join(wikiDir, 'index.md'), 'utf-8')).toBe(indexBefore);
    expect(existsSync(join(wikiDir, 'log.md'))).toBe(false);

    // Findings about the page that would be removed are left out.
    const files = [...result.fixed, ...result.remaining].map((f) => f.file);
    expect(files).not.toContain('entities/gone.md');
    expect(result.fixed.map((f) => f.category)).toContain('stale-entries');
  });

  it('previews exactly what applying reports, linting the wiki as it will be after the deletions', async () => {
    await page(
      'entities/gone.md',
      { type: 'entity', title: 'Gone', tags: [], created: '2026-01-01', sources: ['sources/removed-summary.md'] },
      'See [nowhere](../concepts/nowhere.md) and [only from gone](../concepts/only-from-gone.md).',
    );
    await page('concepts/keeper.md', { type: 'concept', title: 'Keeper', tags: [], created: '2026-01-01' }, 'Built on [Gone](../entities/gone.md).');
    await page('concepts/only-from-gone.md', { type: 'concept', title: 'Only from gone', tags: [], created: '2026-01-01' });
    await writeIndex(join(wikiDir, 'index.md'), [
      { path: 'entities/gone.md', title: 'Gone', summary: '', category: 'Entities', tags: [] },
      { path: 'concepts/keeper.md', title: 'Keeper', summary: '', category: 'Concepts', tags: [] },
    ]);
    const sorted = (findings: LintFinding[]) =>
      findings.map((f) => `${f.category} | ${f.file} | ${f.message}`).sort();

    const preview = await fixWiki(root, { dryRun: true });
    const applied = await fixWiki(root);

    expect(preview.removed_pages).toEqual(['entities/gone.md']);
    expect(applied.removed_pages).toEqual(['entities/gone.md']);
    expect(sorted(preview.fixed)).toEqual(sorted(applied.fixed));
    expect(sorted(preview.remaining)).toEqual(sorted(applied.remaining));

    // The link to the removed page breaks…
    expect(preview.remaining).toContainEqual(
      expect.objectContaining({ category: 'broken-links', file: 'concepts/keeper.md' }),
    );
    // …the removed page's own links no longer count…
    expect(JSON.stringify(preview)).not.toContain('concepts/nowhere.md');
    // …and the page only it linked to becomes an orphan that gets indexed.
    expect(preview.fixed).toContainEqual(
      expect.objectContaining({ category: 'orphan-pages', file: 'concepts/only-from-gone.md' }),
    );
  });
});

describe('lintFix', () => {
  it('dryRun reports fixes without writing', async () => {
    await page('concepts/unindexed.md', { type: 'concept', title: 'Unindexed' });
    await writeIndex(join(wikiDir, 'index.md'), [
      { path: 'concepts/stale.md', title: 'Stale', summary: '', category: 'Concepts', tags: [] },
    ]);
    const indexBefore = await readFile(join(wikiDir, 'index.md'), 'utf-8');
    const pageBefore = await readFile(join(wikiDir, 'concepts', 'unindexed.md'), 'utf-8');

    const result = await lintFix(root, { fixOrphans: true, dryRun: true });

    expect(result.fixedCount).toBeGreaterThan(0);
    expect(await readFile(join(wikiDir, 'index.md'), 'utf-8')).toBe(indexBefore);
    expect(await readFile(join(wikiDir, 'concepts', 'unindexed.md'), 'utf-8')).toBe(pageBefore);
  });

  it('adds an unindexed orphan page to the index only once', async () => {
    await page('entities/orphan.md', { type: 'entity', title: 'Orphan', tags: [], created: '2026-01-01' });
    await writeIndex(join(wikiDir, 'index.md'), []);

    const result = await lintFix(root, { fixOrphans: true });

    const fixedCategories = result.fixed.map((f) => f.category).sort();
    expect(fixedCategories).toEqual(['index-completeness', 'orphan-pages']);
    const entries = await readIndex(join(wikiDir, 'index.md'));
    expect(entries.filter((e) => e.path === 'entities/orphan.md')).toHaveLength(1);
  });

  it('still reports remaining findings when the index file is missing', async () => {
    await writeFile(join(wikiDir, 'concepts', 'x.md'), '# no frontmatter\n\n[gone](gone.md)\n');
    const result = await lintFix(root);
    expect(result.remaining.some((f) => f.category === 'broken-links')).toBe(true);
  });
});

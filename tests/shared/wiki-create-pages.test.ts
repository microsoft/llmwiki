import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEntityPage, createConceptPage, readPage, upsertDerivedPage, writePage } from '../../packages/core/src/wiki.js';
import { readIndex, updateIndexEntry } from '../../packages/core/src/index-ops.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createEntityPage', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'wiki-entity-test-'));
    // Seed an empty index.md so addEntry can read it
    await writeFile(join(wikiDir, 'index.md'), '', 'utf-8');
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('should create an entity page with correct frontmatter and body', async () => {
    const result = await createEntityPage(wikiDir, 'Alan Turing', 'A pioneer of CS.', ['cs', 'math']);

    expect(result.path).toBe('entities/alan-turing.md');

    const page = await readPage(join(wikiDir, result.path));
    expect(page.frontmatter.type).toBe('entity');
    expect(page.frontmatter.title).toBe('Alan Turing');
    expect(page.frontmatter.tags).toEqual(['cs', 'math']);
    expect(page.frontmatter.created).toBeDefined();
    expect(page.body).toContain('A pioneer of CS.');
  });

  it('should register the entity in the wiki index', async () => {
    const result = await createEntityPage(wikiDir, 'Ada Lovelace', 'First programmer.', ['history']);

    expect(result.indexEntry).toEqual({
      path: 'entities/ada-lovelace.md',
      title: 'Ada Lovelace',
      summary: '',
      category: 'Entities',
      tags: ['history'],
    });

    const entries = await readIndex(join(wikiDir, 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('entities/ada-lovelace.md');
    expect(entries[0].title).toBe('Ada Lovelace');
    expect(entries[0].category).toBe('Entities');
  });

  it('should default tags to empty array', async () => {
    const result = await createEntityPage(wikiDir, 'No Tags Entity', 'Body text.');

    expect(result.indexEntry.tags).toEqual([]);

    const page = await readPage(join(wikiDir, result.path));
    expect(page.frontmatter.tags).toEqual([]);
  });

  it('should slugify the name for the file path', async () => {
    const result = await createEntityPage(wikiDir, 'Some Complex Name!', 'Content.');
    expect(result.path).toBe('entities/some-complex-name.md');
  });

  it('should update the existing index entry when the page is created again', async () => {
    await createEntityPage(wikiDir, 'Ada Lovelace', 'First version.', ['history']);
    await updateIndexEntry(join(wikiDir, 'index.md'), 'entities/ada-lovelace.md', { summary: 'First programmer' });

    await createEntityPage(wikiDir, 'Ada Lovelace', 'Second version.', ['history', 'math']);

    const entries = await readIndex(join(wikiDir, 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toEqual(['history', 'math']);
    expect(entries[0].summary).toBe('First programmer');
  });
});

describe('createConceptPage', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'wiki-concept-test-'));
    await writeFile(join(wikiDir, 'index.md'), '', 'utf-8');
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('should create a concept page with correct frontmatter and body', async () => {
    const result = await createConceptPage(wikiDir, 'Neural Networks', 'A type of ML model.', ['ml', 'ai']);

    expect(result.path).toBe('concepts/neural-networks.md');

    const page = await readPage(join(wikiDir, result.path));
    expect(page.frontmatter.type).toBe('concept');
    expect(page.frontmatter.title).toBe('Neural Networks');
    expect(page.frontmatter.tags).toEqual(['ml', 'ai']);
    expect(page.frontmatter.created).toBeDefined();
    expect(page.body).toContain('A type of ML model.');
  });

  it('should register the concept in the wiki index', async () => {
    const result = await createConceptPage(wikiDir, 'Backpropagation', 'Training algorithm.', ['ml']);

    expect(result.indexEntry).toEqual({
      path: 'concepts/backpropagation.md',
      title: 'Backpropagation',
      summary: '',
      category: 'Concepts',
      tags: ['ml'],
    });

    const entries = await readIndex(join(wikiDir, 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('concepts/backpropagation.md');
    expect(entries[0].category).toBe('Concepts');
  });

  it('should default tags to empty array', async () => {
    const result = await createConceptPage(wikiDir, 'Gradient Descent', 'An optimization technique.');

    expect(result.indexEntry.tags).toEqual([]);

    const page = await readPage(join(wikiDir, result.path));
    expect(page.frontmatter.tags).toEqual([]);
  });
});

describe('upsertDerivedPage', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'wiki-upsert-test-'));
    await writeFile(join(wikiDir, 'index.md'), '', 'utf-8');
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('creates a new page that records its source', async () => {
    const result = await upsertDerivedPage(wikiDir, 'entity', 'Grace Hopper', 'Wrote A-0.', ['people'], 'sources/a-summary.md');

    expect(result).toMatchObject({ path: 'entities/grace-hopper.md', created: true });
    const page = await readPage(join(wikiDir, result.path));
    expect(page.frontmatter.sources).toEqual(['sources/a-summary.md']);
    expect(page.body).toBe('Wrote A-0.');
  });

  it('extends an existing derived page instead of overwriting it', async () => {
    await upsertDerivedPage(wikiDir, 'concept', 'COBOL', 'Business language (1959).', ['language'], 'sources/a-summary.md');
    await writePage(join(wikiDir, 'concepts', 'cobol.md'), {
      frontmatter: { ...(await readPage(join(wikiDir, 'concepts', 'cobol.md'))).frontmatter },
      body: 'Business language (1959).\n\n## See also\n\n- [Hopper](../entities/grace-hopper.md)',
    });

    const result = await upsertDerivedPage(wikiDir, 'concept', 'COBOL', 'Designed by CODASYL.', ['history'], 'sources/b-summary.md');

    expect(result.created).toBe(false);
    const page = await readPage(join(wikiDir, 'concepts', 'cobol.md'));
    expect(page.body).toBe(
      'Business language (1959).\n\nDesigned by CODASYL.\n\n## See also\n\n- [Hopper](../entities/grace-hopper.md)',
    );
    expect(page.frontmatter.tags).toEqual(['language', 'history']);
    expect(page.frontmatter.sources).toEqual(['sources/a-summary.md', 'sources/b-summary.md']);
    const entries = await readIndex(join(wikiDir, 'index.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toEqual(['language', 'history']);
  });

  it('does not repeat content that is already on the page', async () => {
    await upsertDerivedPage(wikiDir, 'entity', 'Ada', 'Wrote the first program.', [], 'sources/a-summary.md');
    await upsertDerivedPage(wikiDir, 'entity', 'Ada', 'Wrote the first program.', [], 'sources/a-summary.md');

    const page = await readPage(join(wikiDir, 'entities', 'ada.md'));
    expect(page.body).toBe('Wrote the first program.');
    expect(page.frontmatter.sources).toEqual(['sources/a-summary.md']);
  });

  it('never adds sources to a hand-written page', async () => {
    await writePage(join(wikiDir, 'entities', 'mine.md'), {
      frontmatter: { type: 'entity', title: 'Mine', tags: ['personal'] },
      body: 'My own notes.',
    });

    await upsertDerivedPage(wikiDir, 'entity', 'Mine', 'From a source.', [], 'sources/a-summary.md');

    const page = await readPage(join(wikiDir, 'entities', 'mine.md'));
    expect(page.frontmatter.sources).toBeUndefined();
    expect(page.frontmatter.title).toBe('Mine');
    expect(page.body).toBe('My own notes.\n\nFrom a source.');
  });
});

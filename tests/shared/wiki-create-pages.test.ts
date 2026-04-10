import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEntityPage, createConceptPage, readPage } from '../../packages/shared/src/wiki.js';
import { readIndex } from '../../packages/shared/src/index-ops.js';
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

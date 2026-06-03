import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readPage, writePage, listPages, getPageLinks } from '../../packages/core/src/wiki.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures', 'wiki');

describe('readPage', () => {
  it('should parse a page with full frontmatter', async () => {
    const page = await readPage(join(fixturesDir, 'valid-page.md'));
    expect(page.frontmatter.type).toBe('entity');
    expect(page.frontmatter.title).toBe('Alan Turing');
    expect(page.frontmatter.tags).toEqual(['computer-science', 'mathematics']);
    expect(page.frontmatter.sources).toEqual(['raw/turing-bio.txt']);
    expect(page.frontmatter.created).toBe('2026-01-15');
    expect(page.frontmatter.updated).toBe('2026-02-20');
    expect(page.body).toContain('Alan Turing was a British mathematician');
  });

  it('should parse a page with minimal frontmatter', async () => {
    const page = await readPage(join(fixturesDir, 'minimal-page.md'));
    expect(page.frontmatter.title).toBe('Quick Note');
    expect(page.frontmatter.tags).toEqual(['notes']);
    expect(page.frontmatter.type).toBeUndefined();
    expect(page.body).toContain('minimal frontmatter');
  });

  it('should handle a page with no frontmatter', async () => {
    const page = await readPage(join(fixturesDir, 'no-frontmatter.md'));
    expect(page.frontmatter).toEqual({});
    expect(page.body).toContain('no YAML frontmatter');
  });

  it('should handle an empty file', async () => {
    const page = await readPage(join(fixturesDir, 'empty.md'));
    expect(page.frontmatter).toEqual({});
    expect(page.body).toBe('');
  });
});

describe('writePage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should write a page and read it back identically', async () => {
    const original = {
      frontmatter: {
        type: 'concept',
        title: 'Test Page',
        tags: ['test', 'example'],
        created: '2026-03-01',
      },
      body: 'This is a test page.\n\nWith multiple paragraphs.',
    };

    const filePath = join(tmpDir, 'test-page.md');
    await writePage(filePath, original);

    const readBack = await readPage(filePath);
    expect(readBack.frontmatter.type).toBe(original.frontmatter.type);
    expect(readBack.frontmatter.title).toBe(original.frontmatter.title);
    expect(readBack.frontmatter.tags).toEqual(original.frontmatter.tags);
    expect(readBack.frontmatter.created).toBe(original.frontmatter.created);
    expect(readBack.body).toContain('This is a test page.');
    expect(readBack.body).toContain('With multiple paragraphs.');
  });

  it('should create parent directories if they do not exist', async () => {
    const filePath = join(tmpDir, 'sub', 'dir', 'page.md');
    await writePage(filePath, { frontmatter: { title: 'Deep' }, body: 'nested' });
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Deep');
    expect(content).toContain('nested');
  });
});

describe('listPages', () => {
  it('should list all .md files recursively', async () => {
    const pages = await listPages(fixturesDir);
    const basenames = pages.map(p => p.replace(/\\/g, '/'));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(basenames.some(p => p.endsWith('valid-page.md'))).toBe(true);
    expect(basenames.some(p => p.endsWith('minimal-page.md'))).toBe(true);
    expect(basenames.some(p => p.endsWith('no-frontmatter.md'))).toBe(true);
    expect(basenames.some(p => p.endsWith('empty.md'))).toBe(true);
    expect(basenames.some(p => p.includes('subdir') && p.endsWith('nested-page.md'))).toBe(true);
  });

  it('should return empty array for non-existent directory', async () => {
    const pages = await listPages('/tmp/does-not-exist-wiki');
    expect(pages).toEqual([]);
  });
});

describe('getPageLinks', () => {
  it('should extract internal .md links', () => {
    const content = 'See [concepts](concepts/ai.md) and [entities](entities/turing.md)';
    const links = getPageLinks(content);
    expect(links).toEqual(['concepts/ai.md', 'entities/turing.md']);
  });

  it('should ignore external URLs', () => {
    const content = 'Visit [Google](https://google.com) and [local](page.md)';
    const links = getPageLinks(content);
    expect(links).toEqual(['page.md']);
  });

  it('should ignore non-.md links', () => {
    const content = 'See [image](photo.png) and [doc](page.md)';
    const links = getPageLinks(content);
    expect(links).toEqual(['page.md']);
  });

  it('should return empty array when no links', () => {
    const links = getPageLinks('No links here, just text.');
    expect(links).toEqual([]);
  });

  it('should extract multiple links from complex content', () => {
    const content = `
Check [Alan Turing](entities/turing.md) who worked on
[computer science](concepts/cs.md) and also see
[this website](https://example.com) for more info.
Related: [Shannon](shannon.md).
    `;
    const links = getPageLinks(content);
    expect(links).toEqual(['entities/turing.md', 'concepts/cs.md', 'shannon.md']);
  });
});

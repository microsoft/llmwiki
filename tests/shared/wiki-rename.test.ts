import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renamePage, writePage, readPage, getPageLinks } from '../../packages/shared/src/wiki.js';
import { addEntry, readIndex } from '../../packages/shared/src/index-ops.js';
import { mkdtemp, rm, writeFile, stat, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('renamePage', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'wiki-rename-test-'));
    // Seed an empty index.md so readIndex/writeIndex can read it
    await writeFile(join(wikiDir, 'index.md'), '', 'utf-8');
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('should rename a page successfully (happy path)', async () => {
    // Arrange
    const oldRel = 'concepts/old-page.md';
    await writePage(join(wikiDir, oldRel), {
      frontmatter: { title: 'Custom Title' },
      body: 'Some content here.',
    });

    // Act
    const result = await renamePage(wikiDir, oldRel, 'concepts/new-page.md');

    // Assert: old file gone, new file exists with same content
    await expect(stat(join(wikiDir, oldRel))).rejects.toThrow();
    const newPage = await readPage(join(wikiDir, 'concepts/new-page.md'));
    expect(newPage.body).toBe('Some content here.');
    expect(result.renamed).toBe(true);
    expect(result.oldPath).toBe(oldRel);
    expect(result.newPath).toBe('concepts/new-page.md');
  });

  it('should rewrite a backlink in another page', async () => {
    // Arrange: create target page and a page that links to it
    const targetRel = 'concepts/target.md';
    await writePage(join(wikiDir, targetRel), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });
    await writePage(join(wikiDir, 'linker.md'), {
      frontmatter: { title: 'Linker' },
      body: 'See [target](concepts/target.md) for details.',
    });

    // Act
    const result = await renamePage(wikiDir, targetRel, 'concepts/renamed-target.md');

    // Assert: linker's link now points to new path
    const linkerPage = await readPage(join(wikiDir, 'linker.md'));
    const links = getPageLinks(linkerPage.body);
    expect(links).toContain('concepts/renamed-target.md');
    expect(links).not.toContain('concepts/target.md');
    expect(result.rewrittenLinks).toBe(1);
    expect(result.affectedPages).toContain('linker.md');
  });

  it('should rewrite backlinks in multiple pages', async () => {
    // Arrange: target and three pages linking to it
    const targetRel = 'concepts/target.md';
    await writePage(join(wikiDir, targetRel), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });
    await writePage(join(wikiDir, 'a.md'), {
      frontmatter: { title: 'A' },
      body: 'Link to [target](concepts/target.md).',
    });
    await writePage(join(wikiDir, 'b.md'), {
      frontmatter: { title: 'B' },
      body: 'Also see [target page](concepts/target.md).',
    });
    await writePage(join(wikiDir, 'c.md'), {
      frontmatter: { title: 'C' },
      body: 'Another [ref](concepts/target.md) here.',
    });

    // Act
    const result = await renamePage(wikiDir, targetRel, 'concepts/new-target.md');

    // Assert
    expect(result.rewrittenLinks).toBe(3);
    expect(result.affectedPages).toHaveLength(3);

    for (const file of ['a.md', 'b.md', 'c.md']) {
      const page = await readPage(join(wikiDir, file));
      const links = getPageLinks(page.body);
      expect(links).toContain('concepts/new-target.md');
      expect(links).not.toContain('concepts/target.md');
    }
  });

  it('should throw when source page does not exist', async () => {
    await expect(
      renamePage(wikiDir, 'does-not-exist.md', 'new-name.md'),
    ).rejects.toThrow('Page not found: does-not-exist.md');
  });

  it('should throw when target path already exists', async () => {
    // Arrange: create both source and target
    await writePage(join(wikiDir, 'source.md'), {
      frontmatter: { title: 'Source' },
      body: 'Source content.',
    });
    await writePage(join(wikiDir, 'target.md'), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });

    // Act & Assert
    await expect(
      renamePage(wikiDir, 'source.md', 'target.md'),
    ).rejects.toThrow('Target path already exists: target.md');
  });

  it('should reject path traversal on oldPath', async () => {
    await expect(
      renamePage(wikiDir, '../../etc/passwd', 'new-page.md'),
    ).rejects.toThrow('Path traversal detected');
  });

  it('should reject path traversal on newPath', async () => {
    // Create a valid source page
    await writePage(join(wikiDir, 'source.md'), {
      frontmatter: { title: 'Source' },
      body: 'Content.',
    });

    await expect(
      renamePage(wikiDir, 'source.md', '../../etc/passwd'),
    ).rejects.toThrow('Path traversal detected');
  });

  it('should handle subdirectory move and update links', async () => {
    // Arrange: page in concepts/ and a linker at root
    const oldRel = 'concepts/foo.md';
    await writePage(join(wikiDir, oldRel), {
      frontmatter: { title: 'Foo' },
      body: 'Foo content.',
    });
    await writePage(join(wikiDir, 'linker.md'), {
      frontmatter: { title: 'Linker' },
      body: 'See [foo](concepts/foo.md).',
    });

    // Act: move to entities/
    const result = await renamePage(wikiDir, oldRel, 'entities/foo.md');

    // Assert: file moved
    await expect(stat(join(wikiDir, oldRel))).rejects.toThrow();
    const movedPage = await readPage(join(wikiDir, 'entities/foo.md'));
    expect(movedPage.body).toBe('Foo content.');

    // Assert: linker updated
    const linkerPage = await readPage(join(wikiDir, 'linker.md'));
    const links = getPageLinks(linkerPage.body);
    expect(links).toContain('entities/foo.md');
    expect(links).not.toContain('concepts/foo.md');
    expect(result.rewrittenLinks).toBe(1);
  });

  it('should update the index entry to the new path', async () => {
    // Arrange
    const oldRel = 'entities/old-entity.md';
    await writePage(join(wikiDir, oldRel), {
      frontmatter: { title: 'Custom Title' },
      body: 'Entity content.',
    });
    await addEntry(join(wikiDir, 'index.md'), {
      path: oldRel,
      title: 'Custom Title',
      summary: 'An entity',
      category: 'Entities',
      tags: ['test'],
    });

    // Verify index has old entry
    const before = await readIndex(join(wikiDir, 'index.md'));
    expect(before.find((e) => e.path === oldRel)).toBeDefined();

    // Act
    const newRel = 'entities/new-entity.md';
    await renamePage(wikiDir, oldRel, newRel);

    // Assert: index entry updated
    const after = await readIndex(join(wikiDir, 'index.md'));
    expect(after.find((e) => e.path === oldRel)).toBeUndefined();
    expect(after.find((e) => e.path === newRel)).toBeDefined();
  });

  it('should create parent directories for the new path', async () => {
    // Arrange: page at root
    await writePage(join(wikiDir, 'page.md'), {
      frontmatter: { title: 'Page' },
      body: 'Content.',
    });

    // Act: move to a deeply nested non-existent directory
    await renamePage(wikiDir, 'page.md', 'deep/nested/dir/page.md');

    // Assert: new file exists
    const newPage = await readPage(join(wikiDir, 'deep/nested/dir/page.md'));
    expect(newPage.body).toBe('Content.');
  });

  it('should update frontmatter title when path-derived', async () => {
    // Arrange: title matches the old filename stem
    await writePage(join(wikiDir, 'old-name.md'), {
      frontmatter: { title: 'Old Name' },
      body: 'Content.',
    });

    // Act
    await renamePage(wikiDir, 'old-name.md', 'new-name.md');

    // Assert: title derived from new stem
    const page = await readPage(join(wikiDir, 'new-name.md'));
    expect(page.frontmatter.title).toBe('New Name');
  });

  it('should preserve frontmatter title when NOT path-derived', async () => {
    // Arrange: title does NOT match the filename stem
    await writePage(join(wikiDir, 'old-name.md'), {
      frontmatter: { title: 'Completely Different Title' },
      body: 'Content.',
    });

    // Act
    await renamePage(wikiDir, 'old-name.md', 'new-name.md');

    // Assert: title unchanged
    const page = await readPage(join(wikiDir, 'new-name.md'));
    expect(page.frontmatter.title).toBe('Completely Different Title');
  });

  it('should return correct result shape', async () => {
    // Arrange
    const oldRel = 'concepts/target.md';
    await writePage(join(wikiDir, oldRel), {
      frontmatter: { title: 'Target' },
      body: 'Content.',
    });
    await writePage(join(wikiDir, 'linker.md'), {
      frontmatter: { title: 'Linker' },
      body: 'See [target](concepts/target.md).',
    });

    // Act
    const result = await renamePage(wikiDir, oldRel, 'concepts/moved.md');

    // Assert result shape
    expect(result).toEqual({
      renamed: true,
      oldPath: oldRel,
      newPath: 'concepts/moved.md',
      rewrittenLinks: 1,
      affectedPages: ['linker.md'],
    });
  });
});

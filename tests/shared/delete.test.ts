import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deletePage, writePage } from '../../packages/core/src/wiki.js';
import { addEntry, readIndex } from '../../packages/core/src/index-ops.js';
import { mkdtemp, rm, writeFile, mkdir, stat, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('deletePage', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'wiki-delete-test-'));
    // Seed an empty index.md so removeEntry can read it
    await writeFile(join(wikiDir, 'index.md'), '', 'utf-8');
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('should delete a page successfully', async () => {
    // Arrange: create a page and register it in the index
    const relPath = 'concepts/target.md';
    await writePage(join(wikiDir, relPath), {
      frontmatter: { title: 'Target Page' },
      body: 'Some content here.',
    });
    await addEntry(join(wikiDir, 'index.md'), {
      path: relPath,
      title: 'Target Page',
      summary: '',
      category: 'Concepts',
      tags: [],
    });

    // Act
    const result = await deletePage(wikiDir, relPath);

    // Assert: result shape
    expect(result.deleted).toBe(true);
    expect(result.deletedPath).toBe(relPath);

    // Assert: file is gone from disk
    await expect(stat(join(wikiDir, relPath))).rejects.toThrow();

    // Assert: index entry is gone
    const entries = await readIndex(join(wikiDir, 'index.md'));
    const found = entries.find((e) => e.path === relPath);
    expect(found).toBeUndefined();
  });

  it('should throw when deleting a non-existent page', async () => {
    await expect(
      deletePage(wikiDir, 'does-not-exist.md'),
    ).rejects.toThrow('Page not found: does-not-exist.md');
  });

  it('should return backlink warnings when other pages link to deleted page', async () => {
    // Arrange: create a target page
    const targetRel = 'concepts/target.md';
    await writePage(join(wikiDir, targetRel), {
      frontmatter: { title: 'Target Page' },
      body: 'Target content.',
    });

    // Create a page that links to the target
    await writePage(join(wikiDir, 'linker.md'), {
      frontmatter: { title: 'Linker Page' },
      body: 'See [target](concepts/target.md) for details.',
    });

    // Act
    const result = await deletePage(wikiDir, targetRel);

    // Assert: backlink warnings present
    expect(result.backlinkWarnings.length).toBeGreaterThanOrEqual(1);
    expect(result.backlinkWarnings[0].sourceTitle).toBe('Linker Page');
    expect(result.backlinkWarnings[0].linkText).toBe('target');
  });

  it('should remove the index entry on delete', async () => {
    // Arrange: create page + index entry
    const relPath = 'entities/test-entity.md';
    await writePage(join(wikiDir, relPath), {
      frontmatter: { title: 'Test Entity' },
      body: 'Entity content.',
    });
    await addEntry(join(wikiDir, 'index.md'), {
      path: relPath,
      title: 'Test Entity',
      summary: 'A test entity',
      category: 'Entities',
      tags: ['test'],
    });

    // Verify index has the entry before delete
    const beforeEntries = await readIndex(join(wikiDir, 'index.md'));
    expect(beforeEntries.find((e) => e.path === relPath)).toBeDefined();

    // Act
    await deletePage(wikiDir, relPath);

    // Assert: index entry removed
    const afterEntries = await readIndex(join(wikiDir, 'index.md'));
    expect(afterEntries.find((e) => e.path === relPath)).toBeUndefined();
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      deletePage(wikiDir, '../../etc/passwd'),
    ).rejects.toThrow('Path traversal detected');
  });

  it.each(['index.md', 'Index.md', 'LOG.md', 'concepts/../Log.md'])(
    'refuses to delete %s (case-insensitive file systems)',
    async (pagePath) => {
      await expect(deletePage(wikiDir, pagePath)).rejects.toThrow('special wiki file');
      expect(existsSync(join(wikiDir, 'index.md'))).toBe(true);
    },
  );

  describe('through symlinked folders', () => {
    let outside: string;

    // Junctions need no special rights on Windows; elsewhere these are symlinks.
    const link = (target: string, name: string) => symlink(target, join(wikiDir, name), 'junction');

    beforeEach(async () => {
      outside = await mkdtemp(join(tmpdir(), 'wiki-delete-outside-'));
      await writeFile(join(outside, 'source.md'), '# Raw source', 'utf-8');
      await link(outside, 'linked');
    });

    afterEach(async () => {
      await rm(outside, { recursive: true, force: true });
    });

    it('refuses a page whose folder links outside the wiki', async () => {
      await expect(deletePage(wikiDir, 'linked/source.md')).rejects.toThrow('Path traversal detected');
      expect(existsSync(join(outside, 'source.md'))).toBe(true);
    });

    it.each(['self/index.md', 'self/Index.md', 'self/log.md'])(
      'refuses %s, which resolves to a special wiki file',
      async (pagePath) => {
        await link(wikiDir, 'self');
        await expect(deletePage(wikiDir, pagePath)).rejects.toThrow('special wiki file');
        expect(existsSync(join(wikiDir, 'index.md'))).toBe(true);
      },
    );

    it('still deletes a page reached through a folder link inside the wiki', async () => {
      await writePage(join(wikiDir, 'concepts', 'target.md'), {
        frontmatter: { title: 'Target' },
        body: 'Body.',
      });
      await link(join(wikiDir, 'concepts'), 'alias');

      await deletePage(wikiDir, 'alias/target.md');

      expect(existsSync(join(wikiDir, 'concepts', 'target.md'))).toBe(false);
    });
  });
});

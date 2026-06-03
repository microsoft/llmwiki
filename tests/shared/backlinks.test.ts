import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBacklinks } from '../../packages/core/src/backlinks.js';
import { writePage } from '../../packages/core/src/wiki.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('getBacklinks', () => {
  let tmpDir: string;
  let wikiDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'backlinks-test-'));
    wikiDir = join(tmpDir, 'wiki');
    await mkdir(wikiDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return empty array when no pages exist', async () => {
    const result = await getBacklinks(wikiDir, 'target.md');
    expect(result).toEqual([]);
  });

  it('should return empty array when wiki directory does not exist', async () => {
    const result = await getBacklinks(join(tmpDir, 'nonexistent'), 'target.md');
    expect(result).toEqual([]);
  });

  it('should find backlinks from pages linking to the target', async () => {
    // Create target page
    await writePage(join(wikiDir, 'concepts', 'ai.md'), {
      frontmatter: { title: 'Artificial Intelligence' },
      body: 'AI is the simulation of human intelligence.',
    });

    // Create a page that links to the target
    await writePage(join(wikiDir, 'entities', 'turing.md'), {
      frontmatter: { title: 'Alan Turing' },
      body: 'Turing pioneered [artificial intelligence](../concepts/ai.md) and computation.',
    });

    // Create a page that does NOT link to the target
    await writePage(join(wikiDir, 'entities', 'shannon.md'), {
      frontmatter: { title: 'Claude Shannon' },
      body: 'Shannon worked on information theory.',
    });

    const result = await getBacklinks(wikiDir, 'concepts/ai.md');
    expect(result).toHaveLength(1);
    expect(result[0].sourceTitle).toBe('Alan Turing');
    expect(result[0].linkText).toBe('artificial intelligence');
    expect(result[0].sourcePage).toContain('turing.md');
  });

  it('should find multiple backlinks from different pages', async () => {
    await writePage(join(wikiDir, 'target.md'), {
      frontmatter: { title: 'Target Page' },
      body: 'I am the target.',
    });

    await writePage(join(wikiDir, 'page-a.md'), {
      frontmatter: { title: 'Page A' },
      body: 'See [the target](target.md) for details.',
    });

    await writePage(join(wikiDir, 'page-b.md'), {
      frontmatter: { title: 'Page B' },
      body: 'Also see [target page](target.md) here.',
    });

    const result = await getBacklinks(wikiDir, 'target.md');
    expect(result).toHaveLength(2);

    const titles = result.map((r) => r.sourceTitle).sort();
    expect(titles).toEqual(['Page A', 'Page B']);
  });

  it('should find multiple backlinks from the same page', async () => {
    await writePage(join(wikiDir, 'target.md'), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });

    await writePage(join(wikiDir, 'linker.md'), {
      frontmatter: { title: 'Linker Page' },
      body: 'First [link one](target.md) and second [link two](target.md).',
    });

    const result = await getBacklinks(wikiDir, 'target.md');
    expect(result).toHaveLength(2);
    expect(result[0].linkText).toBe('link one');
    expect(result[1].linkText).toBe('link two');
  });

  it('should use filename as title when frontmatter title is missing', async () => {
    await writePage(join(wikiDir, 'target.md'), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });

    await writePage(join(wikiDir, 'no-title.md'), {
      frontmatter: {},
      body: 'See [here](target.md).',
    });

    const result = await getBacklinks(wikiDir, 'target.md');
    expect(result).toHaveLength(1);
    expect(result[0].sourceTitle).toBe('no-title');
  });

  it('should ignore external links', async () => {
    await writePage(join(wikiDir, 'target.md'), {
      frontmatter: { title: 'Target' },
      body: 'Target content.',
    });

    await writePage(join(wikiDir, 'external.md'), {
      frontmatter: { title: 'External Links' },
      body: 'See [Google](https://google.com) and [example](http://example.com/target.md).',
    });

    const result = await getBacklinks(wikiDir, 'target.md');
    expect(result).toEqual([]);
  });

  it('should handle nested directory structure with relative links', async () => {
    await mkdir(join(wikiDir, 'concepts'), { recursive: true });
    await mkdir(join(wikiDir, 'entities'), { recursive: true });

    await writePage(join(wikiDir, 'concepts', 'cs.md'), {
      frontmatter: { title: 'Computer Science' },
      body: 'CS is a broad field.',
    });

    // Link from sibling directory using relative path
    await writePage(join(wikiDir, 'entities', 'turing.md'), {
      frontmatter: { title: 'Alan Turing' },
      body: 'Turing contributed to [computer science](../concepts/cs.md).',
    });

    // Link from same directory
    await writePage(join(wikiDir, 'concepts', 'algorithms.md'), {
      frontmatter: { title: 'Algorithms' },
      body: 'Algorithms are part of [CS](cs.md).',
    });

    const result = await getBacklinks(wikiDir, 'concepts/cs.md');
    expect(result).toHaveLength(2);

    const titles = result.map((r) => r.sourceTitle).sort();
    expect(titles).toEqual(['Alan Turing', 'Algorithms']);
  });
});

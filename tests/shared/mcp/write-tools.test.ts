import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { handleWriteToolCall } from '../../../packages/shared/src/mcp/write-tools.js';
import { readPage } from '../../../packages/shared/src/wiki.js';
import { readIndex, writeIndex } from '../../../packages/shared/src/index-ops.js';
import type { IndexEntry } from '../../../packages/shared/src/index-ops.js';

let wikiRoot: string;
let wikiDir: string;
let indexPath: string;

beforeEach(async () => {
  wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-write-test-'));
  wikiDir = join(wikiRoot, 'wiki');
  indexPath = join(wikiDir, 'index.md');
  await mkdir(wikiDir, { recursive: true });
});

afterEach(async () => {
  await rm(wikiRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// wiki_write_page
// ---------------------------------------------------------------------------

describe('wiki_write_page', () => {
  it('should create a new page with valid frontmatter', async () => {
    const result = await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'Artificial Intelligence',
        type: 'concept',
        tags: ['ai', 'machine-learning'],
        body: 'AI is the simulation of human intelligence.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.path).toBe('concepts/ai.md');
    expect(parsed.title).toBe('Artificial Intelligence');
    expect(parsed.type).toBe('concept');
    expect(parsed.tags).toEqual(['ai', 'machine-learning']);

    // Verify the page was actually written
    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.type).toBe('concept');
    expect(page.frontmatter.title).toBe('Artificial Intelligence');
    expect(page.frontmatter.tags).toEqual(['ai', 'machine-learning']);
    expect(page.body).toContain('AI is the simulation of human intelligence.');
  });

  it('should create a page without tags', async () => {
    const result = await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'notes/quick.md',
        title: 'Quick Note',
        type: 'note',
        body: 'Just a quick note.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.tags).toEqual([]);

    const page = await readPage(join(wikiDir, 'notes', 'quick.md'));
    expect(page.frontmatter.tags).toEqual([]);
  });

  it('should auto-update the index entry', async () => {
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'entities/turing.md',
        title: 'Alan Turing',
        type: 'entity',
        tags: ['cs', 'math'],
        body: 'Father of computer science.',
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('entities/turing.md');
    expect(entries[0].title).toBe('Alan Turing');
    expect(entries[0].category).toBe('Entities');
    expect(entries[0].tags).toEqual(['cs', 'math']);
  });

  it('should overwrite an existing page and update the index', async () => {
    // Create initial page
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'AI',
        type: 'concept',
        tags: ['ai'],
        body: 'Original content.',
      },
      wikiRoot,
    );

    // Overwrite
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'Artificial Intelligence',
        type: 'concept',
        tags: ['ai', 'ml'],
        body: 'Updated content.',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.title).toBe('Artificial Intelligence');
    expect(page.body).toContain('Updated content.');
    expect(page.body).not.toContain('Original content.');

    // Index should have exactly one entry (upserted, not duplicated)
    const entries = await readIndex(indexPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Artificial Intelligence');
    expect(entries[0].tags).toEqual(['ai', 'ml']);
  });

  it('should block path traversal', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_write_page',
        {
          pagePath: '../../../etc/passwd',
          title: 'Hack',
          type: 'exploit',
          body: 'malicious',
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Path traversal detected');
  });

  it('should reject missing required title', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_write_page',
        {
          pagePath: 'test.md',
          type: 'concept',
          body: 'Some content.',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'title' must be a non-empty string");
  });

  it('should reject missing required type', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_write_page',
        {
          pagePath: 'test.md',
          title: 'Test',
          body: 'Some content.',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'type' must be a non-empty string");
  });

  it('should reject empty title', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_write_page',
        {
          pagePath: 'test.md',
          title: '',
          type: 'concept',
          body: 'Some content.',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'title' must be a non-empty string");
  });

  it('should reject missing required body', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_write_page',
        {
          pagePath: 'test.md',
          title: 'Test',
          type: 'concept',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'body' must be a non-empty string");
  });

  it('should derive category from path directory', async () => {
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'sources/paper.md',
        title: 'Research Paper',
        type: 'source',
        body: 'A research paper.',
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    expect(entries[0].category).toBe('Sources');
  });

  it('should use "General" category for root-level pages', async () => {
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'standalone.md',
        title: 'Standalone Page',
        type: 'note',
        body: 'A standalone page.',
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    expect(entries[0].category).toBe('General');
  });
});

// ---------------------------------------------------------------------------
// wiki_update_page
// ---------------------------------------------------------------------------

describe('wiki_update_page', () => {
  beforeEach(async () => {
    // Create a page to update in each test
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'AI',
        type: 'concept',
        tags: ['ai'],
        body: 'Artificial Intelligence overview.',
      },
      wikiRoot,
    );
  });

  it('should update the title', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'Artificial Intelligence',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.frontmatter.title).toBe('Artificial Intelligence');
    expect(parsed.indexUpdated).toBe(true);

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.title).toBe('Artificial Intelligence');
    // Body should remain unchanged
    expect(page.body).toContain('Artificial Intelligence overview.');
  });

  it('should update the type', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        type: 'topic',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.type).toBe('topic');
    // Other fields preserved
    expect(page.frontmatter.title).toBe('AI');
    expect(page.frontmatter.tags).toEqual(['ai']);
  });

  it('should update tags', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        tags: ['ai', 'machine-learning', 'deep-learning'],
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.tags).toEqual(['ai', 'machine-learning', 'deep-learning']);

    // Index should reflect new tags
    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.tags).toEqual(['ai', 'machine-learning', 'deep-learning']);
  });

  it('should append body content', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        bodyAppend: 'Machine learning is a subset of AI.',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toContain('Artificial Intelligence overview.');
    expect(page.body).toContain('Machine learning is a subset of AI.');
  });

  it('should replace body content', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        bodyReplace: 'Completely new content.',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toContain('Completely new content.');
    expect(page.body).not.toContain('Artificial Intelligence overview.');
  });

  it('should prefer bodyReplace over bodyAppend when both provided', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        bodyAppend: 'This should be ignored.',
        bodyReplace: 'This should win.',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toContain('This should win.');
    expect(page.body).not.toContain('This should be ignored.');
    expect(page.body).not.toContain('Artificial Intelligence overview.');
  });

  it('should fail gracefully if page does not exist', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_update_page',
        {
          pagePath: 'nonexistent/page.md',
          title: 'Ghost',
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Page not found: nonexistent/page.md');
  });

  it('should not update index when only body is changed', async () => {
    // Get initial index state
    const entriesBefore = await readIndex(indexPath);
    const entryBefore = entriesBefore.find((e) => e.path === 'concepts/ai.md');

    const result = await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        bodyAppend: 'Extra content.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.indexUpdated).toBe(false);

    // Index entry should be unchanged
    const entriesAfter = await readIndex(indexPath);
    const entryAfter = entriesAfter.find((e) => e.path === 'concepts/ai.md');
    expect(entryAfter!.title).toBe(entryBefore!.title);
    expect(entryAfter!.tags).toEqual(entryBefore!.tags);
  });

  it('should update index when metadata is changed', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'Artificial Intelligence (Updated)',
        tags: ['ai', 'updated'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.indexUpdated).toBe(true);

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.title).toBe('Artificial Intelligence (Updated)');
    expect(entry!.tags).toEqual(['ai', 'updated']);
  });

  it('should block path traversal', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_update_page',
        {
          pagePath: '../../etc/shadow',
          title: 'Hack',
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Path traversal detected');
  });

  it('should update multiple frontmatter fields at once', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'New Title',
        type: 'new-type',
        tags: ['new-tag'],
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.title).toBe('New Title');
    expect(page.frontmatter.type).toBe('new-type');
    expect(page.frontmatter.tags).toEqual(['new-tag']);
  });

  it('should update frontmatter and body simultaneously', async () => {
    await handleWriteToolCall(
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        title: 'Updated AI',
        bodyReplace: 'Brand new body.',
      },
      wikiRoot,
    );

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.title).toBe('Updated AI');
    expect(page.body).toContain('Brand new body.');
    expect(page.body).not.toContain('Artificial Intelligence overview.');
  });
});

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------

describe('handleWriteToolCall — unknown tool', () => {
  it('should throw for unknown tool names', async () => {
    await expect(
      handleWriteToolCall('wiki_nonexistent', {}, wikiRoot),
    ).rejects.toThrow('Unknown tool: wiki_nonexistent');
  });
});

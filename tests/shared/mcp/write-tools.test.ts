import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { handleWriteToolCall } from '../../../packages/core/src/mcp/write-tools.js';
import { readPage } from '../../../packages/core/src/wiki.js';
import { readIndex, writeIndex } from '../../../packages/core/src/index-ops.js';
import type { IndexEntry } from '../../../packages/core/src/index-ops.js';

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
// wiki_create_entity
// ---------------------------------------------------------------------------

describe('wiki_create_entity', () => {
  it('should create an entity page with frontmatter and index entry', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Alan Turing',
        content: 'Father of computer science.',
        tags: ['cs', 'math'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.path).toBe('entities/alan-turing.md');
    expect(parsed.title).toBe('Alan Turing');
    expect(parsed.type).toBe('entity');
    expect(parsed.tags).toEqual(['cs', 'math']);

    // Verify the page was actually written
    const page = await readPage(join(wikiDir, 'entities', 'alan-turing.md'));
    expect(page.frontmatter.type).toBe('entity');
    expect(page.frontmatter.title).toBe('Alan Turing');
    expect(page.frontmatter.tags).toEqual(['cs', 'math']);
    expect(page.body).toContain('Father of computer science.');
  });

  it('should create an entity page without tags', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Ada Lovelace',
        content: 'First programmer.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.tags).toEqual([]);
  });

  it('should register the entity in the index', async () => {
    await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Grace Hopper',
        content: 'Invented the compiler.',
        tags: ['cs'],
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'entities/grace-hopper.md');
    expect(entry).toBeDefined();
    expect(entry!.title).toBe('Grace Hopper');
    expect(entry!.category).toBe('Entities');
    expect(entry!.tags).toEqual(['cs']);
  });

  it('should reject missing required name', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_entity',
        { content: 'Some content.' },
        wikiRoot,
      ),
    ).rejects.toThrow("'name' must be a non-empty string");
  });

  it('should reject missing required content', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_entity',
        { name: 'Test Entity' },
        wikiRoot,
      ),
    ).rejects.toThrow("'content' must be a non-empty string");
  });
});

// ---------------------------------------------------------------------------
// wiki_create_concept
// ---------------------------------------------------------------------------

describe('wiki_create_concept', () => {
  it('should create a concept page with frontmatter and index entry', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Machine Learning',
        content: 'A subset of artificial intelligence.',
        tags: ['ai', 'ml'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.path).toBe('concepts/machine-learning.md');
    expect(parsed.title).toBe('Machine Learning');
    expect(parsed.type).toBe('concept');
    expect(parsed.tags).toEqual(['ai', 'ml']);

    // Verify the page was actually written
    const page = await readPage(join(wikiDir, 'concepts', 'machine-learning.md'));
    expect(page.frontmatter.type).toBe('concept');
    expect(page.frontmatter.title).toBe('Machine Learning');
    expect(page.frontmatter.tags).toEqual(['ai', 'ml']);
    expect(page.body).toContain('A subset of artificial intelligence.');
  });

  it('should create a concept page without tags', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Neural Networks',
        content: 'Inspired by the brain.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.tags).toEqual([]);
  });

  it('should register the concept in the index', async () => {
    await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Reinforcement Learning',
        content: 'Learning through rewards.',
        tags: ['rl'],
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/reinforcement-learning.md');
    expect(entry).toBeDefined();
    expect(entry!.title).toBe('Reinforcement Learning');
    expect(entry!.category).toBe('Concepts');
    expect(entry!.tags).toEqual(['rl']);
  });

  it('should reject missing required name', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_concept',
        { content: 'Some content.' },
        wikiRoot,
      ),
    ).rejects.toThrow("'name' must be a non-empty string");
  });

  it('should reject missing required content', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_concept',
        { name: 'Test Concept' },
        wikiRoot,
      ),
    ).rejects.toThrow("'content' must be a non-empty string");
  });
});

// ---------------------------------------------------------------------------
// wiki_add_crosslinks
// ---------------------------------------------------------------------------

describe('wiki_add_crosslinks', () => {
  beforeEach(async () => {
    // Create source and target pages
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
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'entities/openai.md',
        title: 'OpenAI',
        type: 'entity',
        tags: ['company'],
        body: 'OpenAI is an AI company.',
      },
      wikiRoot,
    );
    await handleWriteToolCall(
      'wiki_write_page',
      {
        pagePath: 'concepts/ml.md',
        title: 'Machine Learning',
        type: 'concept',
        tags: ['ml'],
        body: 'ML is a subset of AI.',
      },
      wikiRoot,
    );
  });

  it('should add crosslinks and return status updated', async () => {
    const result = await handleWriteToolCall(
      'wiki_add_crosslinks',
      {
        pagePath: 'concepts/ai.md',
        targetPages: ['entities/openai.md'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.path).toBe('concepts/ai.md');
    expect(parsed.crosslinks).toEqual(['entities/openai.md']);

    // Verify the page has a See also section
    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toContain('## See also');
    expect(page.body).toContain('entities/openai.md');
  });

  it('should add multiple crosslinks', async () => {
    const result = await handleWriteToolCall(
      'wiki_add_crosslinks',
      {
        pagePath: 'concepts/ai.md',
        targetPages: ['entities/openai.md', 'concepts/ml.md'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.crosslinks).toEqual(['entities/openai.md', 'concepts/ml.md']);

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    // Links use relative paths from source page location
    expect(page.body).toContain('openai.md');
    expect(page.body).toContain('ml.md');
  });

  it('should reject empty targetPages', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        {
          pagePath: 'concepts/ai.md',
          targetPages: [],
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'targetPages' must be a non-empty array of strings");
  });

  it('should reject missing targetPages', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        {
          pagePath: 'concepts/ai.md',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'targetPages' must be a non-empty array of strings");
  });

  it('should throw when target page does not exist', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        {
          pagePath: 'concepts/ai.md',
          targetPages: ['entities/nonexistent.md'],
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Target pages not found: entities/nonexistent.md');
  });

  it('should block path traversal on pagePath', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        {
          pagePath: '../../etc/passwd',
          targetPages: ['entities/openai.md'],
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Path traversal detected');
  });

  it('should block path traversal on targetPages', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        {
          pagePath: 'concepts/ai.md',
          targetPages: ['../../etc/passwd'],
        },
        wikiRoot,
      ),
    ).rejects.toThrow('Path traversal detected');
  });
});

// ---------------------------------------------------------------------------
// wiki_update_index
// ---------------------------------------------------------------------------

describe('wiki_update_index', () => {
  beforeEach(async () => {
    // Create a page so there's an index entry
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

  it('should update summary in the index', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'concepts/ai.md',
        summary: 'A brief overview of AI',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.path).toBe('concepts/ai.md');
    expect(parsed.fieldsUpdated).toContain('summary');

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.summary).toBe('A brief overview of AI');
  });

  it('should update tags in the index', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'concepts/ai.md',
        tags: ['ai', 'ml', 'deep-learning'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.fieldsUpdated).toContain('tags');

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.tags).toEqual(['ai', 'ml', 'deep-learning']);
  });

  it('should update category in the index', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'concepts/ai.md',
        category: 'Topics',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.fieldsUpdated).toContain('category');

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.category).toBe('Topics');
  });

  it('should update multiple fields at once', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'concepts/ai.md',
        summary: 'Updated summary',
        tags: ['updated'],
        category: 'NewCategory',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.fieldsUpdated).toEqual(expect.arrayContaining(['summary', 'tags', 'category']));

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry!.summary).toBe('Updated summary');
    expect(entry!.tags).toEqual(['updated']);
    expect(entry!.category).toBe('NewCategory');
  });

  it('should return not_found for non-existent entry', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'nonexistent/page.md',
        summary: 'Does not exist',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('not_found');
    expect(parsed.path).toBe('nonexistent/page.md');
  });

  it('should return fieldsUpdated as empty array when no optional fields provided', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      {
        pagePath: 'concepts/ai.md',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.fieldsUpdated).toEqual([]);
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

// ---------------------------------------------------------------------------
// wiki_create_entity
// ---------------------------------------------------------------------------

describe('wiki_create_entity', () => {
  it('should create an entity page with proper frontmatter', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Alan Turing',
        content: 'Father of computer science.',
        tags: ['cs', 'math'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.path).toBe('entities/alan-turing.md');
    expect(parsed.title).toBe('Alan Turing');
    expect(parsed.type).toBe('entity');
    expect(parsed.tags).toEqual(['cs', 'math']);

    // Verify the page file was written with correct frontmatter
    const page = await readPage(join(wikiDir, 'entities', 'alan-turing.md'));
    expect(page.frontmatter.type).toBe('entity');
    expect(page.frontmatter.title).toBe('Alan Turing');
    expect(page.frontmatter.tags).toEqual(['cs', 'math']);
    expect(page.frontmatter.created).toBeDefined();
    expect(page.body).toBe('Father of computer science.');
  });

  it('should auto-register in index with category "Entities"', async () => {
    await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Grace Hopper',
        content: 'Pioneer of computer programming.',
        tags: ['cs'],
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('entities/grace-hopper.md');
    expect(entries[0].title).toBe('Grace Hopper');
    expect(entries[0].category).toBe('Entities');
    expect(entries[0].tags).toEqual(['cs']);
  });

  it('should slugify names with special characters', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'C++ Programming Language',
        content: 'A general-purpose programming language.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.path).toBe('entities/c-programming-language.md');

    const page = await readPage(join(wikiDir, 'entities', 'c-programming-language.md'));
    expect(page.frontmatter.title).toBe('C++ Programming Language');
  });

  it('should create entity without tags', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Simple Entity',
        content: 'No tags here.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.tags).toEqual([]);

    const page = await readPage(join(wikiDir, 'entities', 'simple-entity.md'));
    expect(page.frontmatter.tags).toEqual([]);
  });

  it('should reject missing required name', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_entity',
        {
          content: 'Some content.',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'name' must be a non-empty string");
  });

  it('should reject missing required content', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_entity',
        {
          name: 'Test Entity',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'content' must be a non-empty string");
  });

  it('should set created timestamp in frontmatter', async () => {
    const before = new Date().toISOString();
    await handleWriteToolCall(
      'wiki_create_entity',
      {
        name: 'Timestamped Entity',
        content: 'Has a timestamp.',
      },
      wikiRoot,
    );
    const after = new Date().toISOString();

    const page = await readPage(join(wikiDir, 'entities', 'timestamped-entity.md'));
    const created = page.frontmatter.created as string;
    expect(created >= before).toBe(true);
    expect(created <= after).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wiki_create_concept
// ---------------------------------------------------------------------------

describe('wiki_create_concept', () => {
  it('should create a concept page with proper frontmatter', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Machine Learning',
        content: 'A subset of artificial intelligence.',
        tags: ['ai', 'ml'],
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.path).toBe('concepts/machine-learning.md');
    expect(parsed.title).toBe('Machine Learning');
    expect(parsed.type).toBe('concept');
    expect(parsed.tags).toEqual(['ai', 'ml']);

    // Verify the page file
    const page = await readPage(join(wikiDir, 'concepts', 'machine-learning.md'));
    expect(page.frontmatter.type).toBe('concept');
    expect(page.frontmatter.title).toBe('Machine Learning');
    expect(page.frontmatter.tags).toEqual(['ai', 'ml']);
    expect(page.frontmatter.created).toBeDefined();
    expect(page.body).toBe('A subset of artificial intelligence.');
  });

  it('should auto-register in index with category "Concepts"', async () => {
    await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Neural Networks',
        content: 'Computational models inspired by the brain.',
        tags: ['ai', 'deep-learning'],
      },
      wikiRoot,
    );

    const entries = await readIndex(indexPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('concepts/neural-networks.md');
    expect(entries[0].title).toBe('Neural Networks');
    expect(entries[0].category).toBe('Concepts');
    expect(entries[0].tags).toEqual(['ai', 'deep-learning']);
  });

  it('should slugify names with special characters', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Object-Oriented Programming (OOP)',
        content: 'A programming paradigm.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.path).toBe('concepts/object-oriented-programming-oop.md');
  });

  it('should create concept without tags', async () => {
    const result = await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Simple Concept',
        content: 'No tags here.',
      },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.tags).toEqual([]);
  });

  it('should reject missing required name', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_concept',
        {
          content: 'Some content.',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'name' must be a non-empty string");
  });

  it('should reject missing required content', async () => {
    await expect(
      handleWriteToolCall(
        'wiki_create_concept',
        {
          name: 'Test Concept',
        },
        wikiRoot,
      ),
    ).rejects.toThrow("'content' must be a non-empty string");
  });

  it('should set created timestamp in frontmatter', async () => {
    const before = new Date().toISOString();
    await handleWriteToolCall(
      'wiki_create_concept',
      {
        name: 'Timestamped Concept',
        content: 'Has a timestamp.',
      },
      wikiRoot,
    );
    const after = new Date().toISOString();

    const page = await readPage(join(wikiDir, 'concepts', 'timestamped-concept.md'));
    const created = page.frontmatter.created as string;
    expect(created >= before).toBe(true);
    expect(created <= after).toBe(true);
  });
});

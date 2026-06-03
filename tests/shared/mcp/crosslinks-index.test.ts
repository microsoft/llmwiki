import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { handleWriteToolCall } from '../../../packages/core/src/mcp/write-tools.js';
import { readPage, writePage } from '../../../packages/core/src/wiki.js';
import { readIndex, addEntry } from '../../../packages/core/src/index-ops.js';
import { addCrosslinks } from '../../../packages/core/src/wiki.js';
import { updateIndexEntry } from '../../../packages/core/src/index-ops.js';

let wikiRoot: string;
let wikiDir: string;
let indexPath: string;

beforeEach(async () => {
  wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-crosslinks-test-'));
  wikiDir = join(wikiRoot, 'wiki');
  indexPath = join(wikiDir, 'index.md');
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'entities'), { recursive: true });
});

afterEach(async () => {
  await rm(wikiRoot, { recursive: true, force: true });
});

// Helper to create a test page
async function createTestPage(relPath: string, title: string, body: string, tags: string[] = []) {
  const fullPath = join(wikiDir, relPath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writePage(fullPath, {
    frontmatter: { type: 'concept', title, tags, created: '2026-01-01T00:00:00Z' },
    body,
  });
}

// ---------------------------------------------------------------------------
// addCrosslinks (unit)
// ---------------------------------------------------------------------------

describe('addCrosslinks', () => {
  it('should add a See also section with links', async () => {
    await createTestPage('concepts/ai.md', 'Artificial Intelligence', 'Content about AI.');
    await createTestPage('concepts/ml.md', 'Machine Learning', 'Content about ML.');

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['concepts/ml.md']);

    const page = await readPage(join(wikiDir, 'concepts/ai.md'));
    expect(page.body).toContain('## See also');
    expect(page.body).toContain('[Machine Learning](ml.md)');
  });

  it('should append to existing See also section', async () => {
    await createTestPage(
      'concepts/ai.md',
      'Artificial Intelligence',
      'Content.\n\n## See also\n\n- [Existing](existing.md)',
    );
    await createTestPage('concepts/ml.md', 'Machine Learning', 'ML content.');

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['concepts/ml.md']);

    const page = await readPage(join(wikiDir, 'concepts/ai.md'));
    expect(page.body).toContain('[Existing](existing.md)');
    expect(page.body).toContain('[Machine Learning](ml.md)');
    // Should only have one "See also" heading
    const matches = page.body.match(/## See also/g);
    expect(matches).toHaveLength(1);
  });

  it('should throw if source page does not exist', async () => {
    await createTestPage('concepts/ml.md', 'Machine Learning', 'ML content.');

    await expect(
      addCrosslinks(wikiDir, 'concepts/nonexistent.md', ['concepts/ml.md']),
    ).rejects.toThrow('Source page not found');
  });

  it('should throw if target page does not exist', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'Content.');

    await expect(
      addCrosslinks(wikiDir, 'concepts/ai.md', ['concepts/nonexistent.md']),
    ).rejects.toThrow('not found');
  });

  it('should handle multiple target pages', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'Content.');
    await createTestPage('concepts/ml.md', 'Machine Learning', 'ML.');
    await createTestPage('entities/openai.md', 'OpenAI', 'OpenAI entity.');

    await addCrosslinks(wikiDir, 'concepts/ai.md', [
      'concepts/ml.md',
      'entities/openai.md',
    ]);

    const page = await readPage(join(wikiDir, 'concepts/ai.md'));
    expect(page.body).toContain('[Machine Learning](ml.md)');
    expect(page.body).toContain('[OpenAI](../entities/openai.md)');
  });

  it('should return early for empty toPages without modifying page', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'Content.');

    await addCrosslinks(wikiDir, 'concepts/ai.md', []);

    const page = await readPage(join(wikiDir, 'concepts/ai.md'));
    expect(page.body).not.toContain('## See also');
  });
});

// ---------------------------------------------------------------------------
// updateIndexEntry (unit)
// ---------------------------------------------------------------------------

describe('updateIndexEntry', () => {
  it('should update summary of existing entry', async () => {
    await addEntry(indexPath, {
      path: 'concepts/ai.md',
      title: 'AI',
      summary: 'Old summary',
      category: 'Concepts',
      tags: ['ai'],
    });

    const result = await updateIndexEntry(indexPath, 'concepts/ai.md', {
      summary: 'New summary about AI',
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry?.summary).toBe('New summary about AI');
  });

  it('should update tags of existing entry', async () => {
    await addEntry(indexPath, {
      path: 'concepts/ai.md',
      title: 'AI',
      summary: '',
      category: 'Concepts',
      tags: ['old-tag'],
    });

    await updateIndexEntry(indexPath, 'concepts/ai.md', {
      tags: ['ai', 'machine-learning'],
    });

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry?.tags).toEqual(['ai', 'machine-learning']);
  });

  it('should update category of existing entry', async () => {
    await addEntry(indexPath, {
      path: 'concepts/ai.md',
      title: 'AI',
      summary: '',
      category: 'Concepts',
      tags: [],
    });

    await updateIndexEntry(indexPath, 'concepts/ai.md', {
      category: 'Technology',
    });

    const entries = await readIndex(indexPath);
    const entry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(entry?.category).toBe('Technology');
  });

  it('should return false for non-existent entry', async () => {
    const result = await updateIndexEntry(indexPath, 'concepts/nonexistent.md', {
      summary: 'test',
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCP tool: wiki_add_crosslinks
// ---------------------------------------------------------------------------

describe('wiki_add_crosslinks (via handleWriteToolCall)', () => {
  it('should crosslink pages via MCP tool', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'AI content.');
    await createTestPage('concepts/ml.md', 'Machine Learning', 'ML content.');

    const result = await handleWriteToolCall(
      'wiki_add_crosslinks',
      { pagePath: 'concepts/ai.md', targetPages: ['concepts/ml.md'] },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.path).toBe('concepts/ai.md');
    expect(parsed.crosslinks).toEqual(['concepts/ml.md']);
  });

  it('should reject empty targetPages', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'Content.');

    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        { pagePath: 'concepts/ai.md', targetPages: [] },
        wikiRoot,
      ),
    ).rejects.toThrow("'targetPages' must be a non-empty array");
  });

  it('should reject path traversal in targetPages', async () => {
    await createTestPage('concepts/ai.md', 'AI', 'Content.');

    await expect(
      handleWriteToolCall(
        'wiki_add_crosslinks',
        { pagePath: 'concepts/ai.md', targetPages: ['../../etc/passwd'] },
        wikiRoot,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MCP tool: wiki_update_index
// ---------------------------------------------------------------------------

describe('wiki_update_index (via handleWriteToolCall)', () => {
  it('should update index entry via MCP tool', async () => {
    await addEntry(indexPath, {
      path: 'concepts/ai.md',
      title: 'AI',
      summary: '',
      category: 'Concepts',
      tags: [],
    });

    const result = await handleWriteToolCall(
      'wiki_update_index',
      { pagePath: 'concepts/ai.md', summary: 'Covers artificial intelligence', tags: ['ai'] },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('updated');
    expect(parsed.fieldsUpdated).toContain('summary');
    expect(parsed.fieldsUpdated).toContain('tags');
  });

  it('should return not_found for non-existent entry', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      { pagePath: 'concepts/nonexistent.md', summary: 'test' },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('not_found');
  });

  it('should return empty fieldsUpdated when no update fields provided', async () => {
    const result = await handleWriteToolCall(
      'wiki_update_index',
      { pagePath: 'concepts/ai.md' },
      wikiRoot,
    );

    const parsed = JSON.parse(result);
    expect(parsed.fieldsUpdated).toEqual([]);
  });
});

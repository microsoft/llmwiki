import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readIndex,
  writeIndex,
  addEntry,
  removeEntry,
  findEntries,
} from '../../packages/shared/src/index-ops.js';
import type { IndexEntry } from '../../packages/shared/src/index-ops.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures', 'index');

describe('readIndex', () => {
  it('should parse a full index with multiple categories', async () => {
    const entries = await readIndex(join(fixturesDir, 'valid-index.md'));
    expect(entries).toHaveLength(5);

    const turing = entries.find((e) => e.title === 'Alan Turing');
    expect(turing).toBeDefined();
    expect(turing!.path).toBe('entities/alan-turing.md');
    expect(turing!.summary).toBe('Father of computer science');
    expect(turing!.category).toBe('Entities');
    expect(turing!.tags).toEqual(['computer-science', 'mathematics']);

    const nn = entries.find((e) => e.title === 'Neural Networks');
    expect(nn).toBeDefined();
    expect(nn!.category).toBe('Concepts');
    expect(nn!.tags).toEqual(['ai', 'deep-learning']);

    const src = entries.find((e) => e.title === 'Turing Biography');
    expect(src).toBeDefined();
    expect(src!.category).toBe('Sources');
    expect(src!.tags).toEqual(['biography']);
  });

  it('should return an empty array for an empty file', async () => {
    const entries = await readIndex(join(fixturesDir, 'empty-index.md'));
    expect(entries).toEqual([]);
  });

  it('should return an empty array for a non-existent file', async () => {
    const entries = await readIndex(join(fixturesDir, 'does-not-exist.md'));
    expect(entries).toEqual([]);
  });

  it('should parse entries without summaries or tags', async () => {
    const entries = await readIndex(join(fixturesDir, 'no-summaries.md'));
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      expect(entry.summary).toBe('');
      expect(entry.tags).toEqual([]);
    }

    expect(entries[0].title).toBe('Alan Turing');
    expect(entries[0].path).toBe('entities/alan-turing.md');
    expect(entries[0].category).toBe('Entities');
  });

  it('should parse entries with tags but no summary text', async () => {
    const entries = await readIndex(join(fixturesDir, 'tags-only.md'));
    expect(entries).toHaveLength(2);

    expect(entries[0].summary).toBe('');
    expect(entries[0].tags).toEqual(['ai', 'deep-learning']);
    expect(entries[1].tags).toEqual(['computer-science', 'theory']);
  });

  it('should parse a single-category index', async () => {
    const entries = await readIndex(join(fixturesDir, 'single-category.md'));
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('Entities');
    expect(entries[0].title).toBe('Alan Turing');
  });
});

describe('writeIndex', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'index-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should write entries and read them back identically', async () => {
    const entries: IndexEntry[] = [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: 'Father of CS',
        category: 'Entities',
        tags: ['cs', 'math'],
      },
      {
        path: 'concepts/ai.md',
        title: 'AI',
        summary: 'Artificial Intelligence',
        category: 'Concepts',
        tags: ['ai'],
      },
    ];

    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, entries);

    const readBack = await readIndex(filePath);
    expect(readBack).toHaveLength(2);
    expect(readBack[0].title).toBe('Alan Turing');
    expect(readBack[0].summary).toBe('Father of CS');
    expect(readBack[0].category).toBe('Entities');
    expect(readBack[0].tags).toEqual(['cs', 'math']);
    expect(readBack[1].title).toBe('AI');
    expect(readBack[1].category).toBe('Concepts');
  });

  it('should produce valid markdown with # Wiki Index heading', async () => {
    const entries: IndexEntry[] = [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: '',
        category: 'Entities',
        tags: [],
      },
    ];

    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, entries);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('# Wiki Index');
    expect(content).toContain('## Entities');
    expect(content).toContain('- [Alan Turing](entities/turing.md)');
  });

  it('should write entries without summary or tags cleanly', async () => {
    const entries: IndexEntry[] = [
      {
        path: 'concepts/ai.md',
        title: 'AI',
        summary: '',
        category: 'Concepts',
        tags: [],
      },
    ];

    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, entries);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('- [AI](concepts/ai.md)');
    // Should NOT have a dangling em-dash
    expect(content).not.toContain('—');
  });

  it('should group entries by category', async () => {
    const entries: IndexEntry[] = [
      { path: 'a.md', title: 'A', summary: '', category: 'Alpha', tags: [] },
      { path: 'b.md', title: 'B', summary: '', category: 'Beta', tags: [] },
      { path: 'c.md', title: 'C', summary: '', category: 'Alpha', tags: [] },
    ];

    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, entries);

    const readBack = await readIndex(filePath);
    const alphaEntries = readBack.filter((e) => e.category === 'Alpha');
    expect(alphaEntries).toHaveLength(2);
    expect(alphaEntries[0].title).toBe('A');
    expect(alphaEntries[1].title).toBe('C');
  });

  it('should create parent directories if needed', async () => {
    const filePath = join(tmpDir, 'sub', 'dir', 'index.md');
    await writeIndex(filePath, [
      { path: 'a.md', title: 'A', summary: '', category: 'Cat', tags: [] },
    ]);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('- [A](a.md)');
  });

  it('should write an empty index when given no entries', async () => {
    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, []);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('# Wiki Index');
    expect(content).not.toContain('##');
  });
});

describe('addEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'index-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should add an entry to an existing category', async () => {
    const filePath = join(tmpDir, 'index.md');
    const initial: IndexEntry[] = [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: 'CS pioneer',
        category: 'Entities',
        tags: ['cs'],
      },
    ];
    await writeIndex(filePath, initial);

    await addEntry(filePath, {
      path: 'entities/shannon.md',
      title: 'Claude Shannon',
      summary: 'Info theory',
      category: 'Entities',
      tags: ['info'],
    });

    const entries = await readIndex(filePath);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.category === 'Entities')).toBe(true);
    expect(entries[1].title).toBe('Claude Shannon');
  });

  it('should create a new category if it does not exist', async () => {
    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: '',
        category: 'Entities',
        tags: [],
      },
    ]);

    await addEntry(filePath, {
      path: 'concepts/ai.md',
      title: 'AI',
      summary: 'Artificial Intelligence',
      category: 'Concepts',
      tags: ['ai'],
    });

    const entries = await readIndex(filePath);
    expect(entries).toHaveLength(2);
    const categories = [...new Set(entries.map((e) => e.category))];
    expect(categories).toContain('Entities');
    expect(categories).toContain('Concepts');
  });

  it('should add an entry to an empty/missing file', async () => {
    const filePath = join(tmpDir, 'new-index.md');

    await addEntry(filePath, {
      path: 'entities/turing.md',
      title: 'Alan Turing',
      summary: 'Pioneer',
      category: 'Entities',
      tags: ['cs'],
    });

    const entries = await readIndex(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Alan Turing');
  });
});

describe('removeEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'index-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should remove an entry by path', async () => {
    const filePath = join(tmpDir, 'index.md');
    const initial: IndexEntry[] = [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: '',
        category: 'Entities',
        tags: [],
      },
      {
        path: 'entities/shannon.md',
        title: 'Claude Shannon',
        summary: '',
        category: 'Entities',
        tags: [],
      },
    ];
    await writeIndex(filePath, initial);

    await removeEntry(filePath, 'entities/turing.md');

    const entries = await readIndex(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Claude Shannon');
  });

  it('should leave file unchanged if path does not exist', async () => {
    const filePath = join(tmpDir, 'index.md');
    const initial: IndexEntry[] = [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: '',
        category: 'Entities',
        tags: [],
      },
    ];
    await writeIndex(filePath, initial);

    await removeEntry(filePath, 'entities/nonexistent.md');

    const entries = await readIndex(filePath);
    expect(entries).toHaveLength(1);
  });

  it('should remove the last entry and leave an empty category-free index', async () => {
    const filePath = join(tmpDir, 'index.md');
    await writeIndex(filePath, [
      {
        path: 'entities/turing.md',
        title: 'Alan Turing',
        summary: '',
        category: 'Entities',
        tags: [],
      },
    ]);

    await removeEntry(filePath, 'entities/turing.md');

    const entries = await readIndex(filePath);
    expect(entries).toEqual([]);
  });
});

describe('findEntries', () => {
  const testEntries: IndexEntry[] = [
    {
      path: 'entities/alan-turing.md',
      title: 'Alan Turing',
      summary: 'Father of CS',
      category: 'Entities',
      tags: ['computer-science', 'mathematics'],
    },
    {
      path: 'entities/claude-shannon.md',
      title: 'Claude Shannon',
      summary: 'Info theory',
      category: 'Entities',
      tags: ['information-theory', 'mathematics'],
    },
    {
      path: 'concepts/neural-networks.md',
      title: 'Neural Networks',
      summary: 'Bio-inspired models',
      category: 'Concepts',
      tags: ['ai', 'deep-learning'],
    },
    {
      path: 'concepts/turing-machine.md',
      title: 'Turing Machine',
      summary: 'Computation model',
      category: 'Concepts',
      tags: ['computer-science'],
    },
  ];

  it('should find entries by title substring (case-insensitive)', () => {
    const results = findEntries(testEntries, { title: 'turing' });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.title)).toContain('Alan Turing');
    expect(results.map((e) => e.title)).toContain('Turing Machine');
  });

  it('should find entries by a single tag', () => {
    const results = findEntries(testEntries, { tags: ['mathematics'] });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.title)).toContain('Alan Turing');
    expect(results.map((e) => e.title)).toContain('Claude Shannon');
  });

  it('should find entries matching any of the provided tags', () => {
    const results = findEntries(testEntries, {
      tags: ['ai', 'information-theory'],
    });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.title)).toContain('Claude Shannon');
    expect(results.map((e) => e.title)).toContain('Neural Networks');
  });

  it('should filter by both title and tags', () => {
    const results = findEntries(testEntries, {
      title: 'turing',
      tags: ['computer-science'],
    });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.title)).toContain('Alan Turing');
    expect(results.map((e) => e.title)).toContain('Turing Machine');
  });

  it('should return all entries when no filters are provided', () => {
    const results = findEntries(testEntries, {});
    expect(results).toHaveLength(4);
  });

  it('should return empty array when no entries match', () => {
    const results = findEntries(testEntries, { title: 'nonexistent' });
    expect(results).toEqual([]);
  });

  it('should return empty array when tags do not match', () => {
    const results = findEntries(testEntries, { tags: ['biology'] });
    expect(results).toEqual([]);
  });

  it('should return empty array for empty input', () => {
    const results = findEntries([], { title: 'anything' });
    expect(results).toEqual([]);
  });
});

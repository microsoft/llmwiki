import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readIndex,
  writeIndex,
  updateIndexEntry,
} from '../../packages/core/src/index-ops.js';
import type { IndexEntry } from '../../packages/core/src/index-ops.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('updateIndexEntry', () => {
  let tmpDir: string;
  let indexPath: string;

  const seedEntries: IndexEntry[] = [
    {
      path: 'entities/turing.md',
      title: 'Alan Turing',
      summary: 'CS pioneer',
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

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'update-index-test-'));
    indexPath = join(tmpDir, 'index.md');
    await writeIndex(indexPath, seedEntries);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return false when entry path is not found', async () => {
    const result = await updateIndexEntry(indexPath, 'nonexistent.md', {
      title: 'New Title',
    });
    expect(result).toBe(false);
  });

  it('should update the title of an existing entry', async () => {
    const result = await updateIndexEntry(indexPath, 'entities/turing.md', {
      title: 'A. M. Turing',
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const updated = entries.find((e) => e.path === 'entities/turing.md');
    expect(updated!.title).toBe('A. M. Turing');
    expect(updated!.summary).toBe('CS pioneer');
  });

  it('should update the summary of an existing entry', async () => {
    const result = await updateIndexEntry(indexPath, 'concepts/ai.md', {
      summary: 'Machine intelligence overview',
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const updated = entries.find((e) => e.path === 'concepts/ai.md');
    expect(updated!.summary).toBe('Machine intelligence overview');
    expect(updated!.title).toBe('AI');
  });

  it('should update the category of an existing entry', async () => {
    const result = await updateIndexEntry(indexPath, 'entities/turing.md', {
      category: 'Historical Figures',
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const updated = entries.find((e) => e.path === 'entities/turing.md');
    expect(updated!.category).toBe('Historical Figures');
  });

  it('should update tags of an existing entry', async () => {
    const result = await updateIndexEntry(indexPath, 'concepts/ai.md', {
      tags: ['machine-learning', 'deep-learning'],
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const updated = entries.find((e) => e.path === 'concepts/ai.md');
    expect(updated!.tags).toEqual(['machine-learning', 'deep-learning']);
  });

  it('should update multiple fields at once', async () => {
    const result = await updateIndexEntry(indexPath, 'entities/turing.md', {
      title: 'Turing, Alan',
      summary: 'Father of computer science',
      tags: ['computing', 'math', 'cryptography'],
    });
    expect(result).toBe(true);

    const entries = await readIndex(indexPath);
    const updated = entries.find((e) => e.path === 'entities/turing.md');
    expect(updated!.title).toBe('Turing, Alan');
    expect(updated!.summary).toBe('Father of computer science');
    expect(updated!.tags).toEqual(['computing', 'math', 'cryptography']);
  });

  it('should not modify other entries', async () => {
    await updateIndexEntry(indexPath, 'entities/turing.md', {
      title: 'Updated Turing',
    });

    const entries = await readIndex(indexPath);
    const other = entries.find((e) => e.path === 'concepts/ai.md');
    expect(other!.title).toBe('AI');
    expect(other!.summary).toBe('Artificial Intelligence');
    expect(other!.tags).toEqual(['ai']);
  });
});

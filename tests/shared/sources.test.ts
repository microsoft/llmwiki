import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listSources } from '../../packages/core/src/sources.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('listSources', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sources-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return empty array for non-existent directory', async () => {
    const result = await listSources(join(tmpDir, 'does-not-exist'));
    expect(result).toEqual([]);
  });

  it('should return empty array for empty directory', async () => {
    const rawDir = join(tmpDir, 'raw');
    await mkdir(rawDir);
    const result = await listSources(rawDir);
    expect(result).toEqual([]);
  });

  it('should list files with correct metadata', async () => {
    const rawDir = join(tmpDir, 'raw');
    await mkdir(rawDir);

    const content = 'Hello, world!';
    await writeFile(join(rawDir, 'notes.txt'), content, 'utf-8');

    const result = await listSources(rawDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('notes.txt');
    expect(result[0].path).toBe('notes.txt');
    expect(result[0].size).toBe(Buffer.byteLength(content));
    expect(result[0].extension).toBe('.txt');
    // modified should be a valid ISO date string
    expect(() => new Date(result[0].modified)).not.toThrow();
    expect(new Date(result[0].modified).getTime()).toBeGreaterThan(0);
  });

  it('should list files in nested directories', async () => {
    const rawDir = join(tmpDir, 'raw');
    await mkdir(join(rawDir, 'sub', 'deep'), { recursive: true });

    await writeFile(join(rawDir, 'top.txt'), 'top-level', 'utf-8');
    await writeFile(join(rawDir, 'sub', 'mid.pdf'), 'mid-level', 'utf-8');
    await writeFile(join(rawDir, 'sub', 'deep', 'bottom.md'), 'deep-level', 'utf-8');

    const result = await listSources(rawDir);
    expect(result).toHaveLength(3);

    const paths = result.map((f) => f.path).sort();
    expect(paths).toEqual(['sub/deep/bottom.md', 'sub/mid.pdf', 'top.txt']);

    // Check extensions
    const byName = Object.fromEntries(result.map((f) => [f.name, f]));
    expect(byName['top.txt'].extension).toBe('.txt');
    expect(byName['mid.pdf'].extension).toBe('.pdf');
    expect(byName['bottom.md'].extension).toBe('.md');
  });

  it('should not include directories in results', async () => {
    const rawDir = join(tmpDir, 'raw');
    await mkdir(join(rawDir, 'subdir'), { recursive: true });
    await writeFile(join(rawDir, 'file.txt'), 'data', 'utf-8');

    const result = await listSources(rawDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('file.txt');
  });

  it('should handle multiple files with different extensions', async () => {
    const rawDir = join(tmpDir, 'raw');
    await mkdir(rawDir);

    await writeFile(join(rawDir, 'doc.txt'), 'text', 'utf-8');
    await writeFile(join(rawDir, 'data.json'), '{}', 'utf-8');
    await writeFile(join(rawDir, 'image.png'), 'fake-png', 'utf-8');

    const result = await listSources(rawDir);
    expect(result).toHaveLength(3);

    const extensions = result.map((f) => f.extension).sort();
    expect(extensions).toEqual(['.json', '.png', '.txt']);
  });
});

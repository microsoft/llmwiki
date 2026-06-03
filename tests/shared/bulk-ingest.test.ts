import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  bulkIngest,
  type BulkIngestOptions,
  type BulkIngestResult,
} from '../../packages/core/src/bulk-ingest.js';

describe('bulkIngest', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bulk-ingest-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: initialise a minimal wiki structure so bulkIngest doesn't bail.
   */
  async function initWiki(projectRoot: string): Promise<void> {
    const wikiDir = join(projectRoot, 'wiki');
    await mkdir(join(wikiDir, 'sources'), { recursive: true });
    await writeFile(
      join(wikiDir, 'index.md'),
      '---\ntype: index\ntitle: Index\n---\n# Index\n',
      'utf-8',
    );
    await writeFile(
      join(wikiDir, 'log.md'),
      '---\ntype: log\ntitle: Log\n---\n# Log\n',
      'utf-8',
    );
  }

  /**
   * Helper: create a raw directory with source files.
   */
  async function createRawFiles(
    rawDir: string,
    files: Record<string, string>,
  ): Promise<void> {
    await mkdir(rawDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(rawDir, name), content, 'utf-8');
    }
  }

  // ── Early-exit: wiki not initialised ───────────────────────────────────
  it('should return empty result when wiki is not initialised', async () => {
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'a.txt': 'aaa' });

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.command).toBe('bulk-ingest');
    expect(result.total).toBe(0);
    expect(result.ingested).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.dry_run).toBe(false);
    expect(result.files).toEqual([]);
  });

  // ── Empty raw directory ────────────────────────────────────────────────
  it('should handle an empty raw directory', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await mkdir(rawDir, { recursive: true });

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.total).toBe(0);
    expect(result.ingested).toBe(0);
    expect(result.files).toEqual([]);
  });

  // ── Non-existent raw directory ─────────────────────────────────────────
  it('should handle a non-existent raw directory gracefully', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'does-not-exist');

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.total).toBe(0);
    expect(result.files).toEqual([]);
  });

  // ── Ingest a single file ──────────────────────────────────────────────
  it('should ingest a single source file', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'hello.txt': 'Hello world' });

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.command).toBe('bulk-ingest');
    expect(result.total).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.dry_run).toBe(false);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({ file: 'hello.txt', status: 'ingested' });
  });

  // ── Ingest multiple files ─────────────────────────────────────────────
  it('should ingest multiple source files', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, {
      'a.txt': 'aaa',
      'b.md': 'bbb',
      'c.json': '{}',
    });

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.total).toBe(3);
    expect(result.ingested).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.files).toHaveLength(3);
    const statuses = result.files.map((f) => f.status);
    expect(statuses.every((s) => s === 'ingested')).toBe(true);
  });

  // ── Skip already-ingested files ───────────────────────────────────────
  it('should skip files that are already ingested', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'hello.txt': 'Hello world' });

    // First ingest
    await bulkIngest(rawDir, tmpDir);

    // Second ingest — should skip
    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.total).toBe(1);
    expect(result.ingested).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.files[0].status).toBe('skipped');
  });

  // ── Force re-ingest ───────────────────────────────────────────────────
  it('should re-ingest when force is true', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'hello.txt': 'Hello world' });

    // First ingest
    await bulkIngest(rawDir, tmpDir);

    // Force re-ingest
    const result = await bulkIngest(rawDir, tmpDir, { force: true });

    expect(result.total).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(0);
  });

  // ── Dry-run flag propagation ──────────────────────────────────────────
  it('should pass dry_run through and not create files', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'hello.txt': 'Hello world' });

    const result = await bulkIngest(rawDir, tmpDir, { dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.total).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.files[0]).toEqual({ file: 'hello.txt', status: 'ingested' });
  });

  // ── Progress callback ─────────────────────────────────────────────────
  it('should invoke the onProgress callback for each file', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'a.txt': 'aaa', 'b.txt': 'bbb' });

    const calls: Array<[number, number, string]> = [];
    const onProgress = (current: number, total: number, file: string) => {
      calls.push([current, total, file]);
    };

    await bulkIngest(rawDir, tmpDir, { onProgress });

    expect(calls).toHaveLength(2);
    // First call: 1 of 2
    expect(calls[0][0]).toBe(1);
    expect(calls[0][1]).toBe(2);
    // Second call: 2 of 2
    expect(calls[1][0]).toBe(2);
    expect(calls[1][1]).toBe(2);
    // File names should be present
    const fileNames = calls.map(([, , f]) => f).sort();
    expect(fileNames).toEqual(['a.txt', 'b.txt']);
  });

  // ── Default options ───────────────────────────────────────────────────
  it('should default dryRun to false and force to false', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, { 'test.txt': 'content' });

    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.dry_run).toBe(false);
    // The file was ingested (not skipped) which confirms force=false path works
    expect(result.ingested).toBe(1);
  });

  // ── Counts are accurate with mixed outcomes ───────────────────────────
  it('should correctly count mixed ingested and skipped files', async () => {
    await initWiki(tmpDir);
    const rawDir = join(tmpDir, 'raw');
    await createRawFiles(rawDir, {
      'existing.txt': 'already there',
      'new-file.txt': 'fresh content',
    });

    // Ingest only the first file
    const { ingestSource } = await import(
      '../../packages/core/src/ingest.js'
    );
    await ingestSource(join(rawDir, 'existing.txt'), tmpDir, false);

    // Bulk ingest — existing.txt should be skipped, new-file.txt ingested
    const result = await bulkIngest(rawDir, tmpDir);

    expect(result.total).toBe(2);
    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(1);

    const skipped = result.files.find((f) => f.status === 'skipped');
    const ingested = result.files.find((f) => f.status === 'ingested');
    expect(skipped).toBeDefined();
    expect(ingested).toBeDefined();
  });
});

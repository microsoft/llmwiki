/**
 * withWikiLock: the wiki write lock shared by the VS Code extension and MCP
 * server processes (a lock file in the wiki directory).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withWikiLock, WIKI_LOCK_FILE } from '../../packages/core/src/lock.js';

let wikiDir: string;
let lockPath: string;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'wiki-lock-'));
  lockPath = join(wikiDir, WIKI_LOCK_FILE);
});

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true });
});

describe('withWikiLock', () => {
  it('holds a lock file in the wiki directory while the operation runs', async () => {
    expect(await withWikiLock(wikiDir, async () => existsSync(lockPath))).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('runs one operation at a time', async () => {
    const events: string[] = [];
    const operation = (name: string) =>
      withWikiLock(wikiDir, async () => {
        events.push(`start ${name}`);
        await sleep(20);
        events.push(`end ${name}`);
      });

    await Promise.all([operation('a'), operation('b'), operation('c')]);

    expect(events).toHaveLength(6);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i + 1]).toBe(events[i].replace('start', 'end'));
    }
  });

  it('waits while another process holds the lock', async () => {
    await writeFile(lockPath, ''); // as another process would
    let ran = false;
    const pending = withWikiLock(wikiDir, async () => {
      ran = true;
    });

    await sleep(150);
    expect(ran).toBe(false);

    await rm(lockPath);
    await pending;
    expect(ran).toBe(true);
  });

  it('takes over a lock left behind by a process that died', async () => {
    await writeFile(lockPath, '');
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    const started = Date.now();
    await withWikiLock(wikiDir, async () => {});

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('is re-entrant within one call chain', async () => {
    const result = await withWikiLock(wikiDir, () => withWikiLock(wikiDir, async () => 'nested'));
    expect(result).toBe('nested');
  });

  it('releases the lock when the operation fails', async () => {
    await expect(
      withWikiLock(wikiDir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(existsSync(lockPath)).toBe(false);
    expect(await withWikiLock(wikiDir, async () => 'again')).toBe('again');
  });

  it('runs without a lock when the wiki directory does not exist', async () => {
    const missing = join(wikiDir, 'missing');
    expect(await withWikiLock(missing, async () => 'ran')).toBe('ran');
    expect(existsSync(missing)).toBe(false);
  });
});

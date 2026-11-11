import { AsyncLocalStorage } from 'node:async_hooks';
import { open, stat, unlink, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNotFoundError } from './errors.js';

/** Lock file that exists in the wiki directory while a write is in progress. */
export const WIKI_LOCK_FILE = '.llmwiki.lock';

/** A lock that hasn't been refreshed for this long was left behind by a process that died. */
const STALE_MS = 10_000;
/** How long to wait for another writer before giving up. */
const TIMEOUT_MS = 30_000;

/** Wiki directories whose lock the current async call chain already holds. */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Errors Windows reports while another process is still releasing the lock file. */
function isTransient(err: unknown): boolean {
  return process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(errorCode(err) ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Run `fn` while holding the write lock of the wiki in `wikiDir`, so that
 * read-modify-write updates of pages and index.md never interleave. The lock
 * is a file in `wikiDir`, which makes it shared by every process that uses
 * @llmwiki/core: the VS Code extension and any MCP servers. It is re-entrant
 * within one async call chain. If `wikiDir` doesn't exist, `fn` runs without
 * a lock.
 */
export async function withWikiLock<T>(wikiDir: string, fn: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? resolve(wikiDir).toLowerCase() : resolve(wikiDir);
  const outer = held.getStore();
  if (outer?.has(key)) return fn();

  const lockPath = join(wikiDir, WIKI_LOCK_FILE);
  if (!(await acquire(lockPath))) return fn();

  // Keep the lock fresh so a long operation isn't mistaken for a dead one.
  const heartbeat = setInterval(() => {
    const now = new Date();
    utimes(lockPath, now, now).catch(() => {});
  }, STALE_MS / 4);
  heartbeat.unref();
  try {
    return await held.run(new Set([...(outer ?? []), key]), fn);
  } finally {
    clearInterval(heartbeat);
    await release(lockPath);
  }
}

/** Create the lock file, waiting while another writer holds it. False if its directory is missing. */
async function acquire(lockPath: string): Promise<boolean> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (let delay = 5; ; delay = Math.min(delay * 2, 100)) {
    try {
      await (await open(lockPath, 'wx')).close();
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      // A transient error with no lock file present is a real permission problem.
      const busy = errorCode(err) === 'EEXIST' || (isTransient(err) && (await mayExist(lockPath)));
      if (!busy) throw err;
      if (Date.now() >= deadline) {
        if (errorCode(err) !== 'EEXIST') throw err;
        throw new Error(
          `Timed out waiting for another LLM Wiki write to finish. If none is running, delete ${lockPath}.`,
        );
      }
    }
    if (await isStale(lockPath)) {
      await unlink(lockPath).catch(() => {});
      continue;
    }
    await sleep(delay);
  }
}

/** False only when the file is definitely absent. */
async function mayExist(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    return !isNotFoundError(err);
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > STALE_MS;
  } catch {
    return false;
  }
}

async function release(lockPath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await unlink(lockPath);
      return;
    } catch (err) {
      // If it can't be removed, other writers take over once it is stale.
      if (!isTransient(err) || attempt >= 5) return;
      await sleep(20);
    }
  }
}

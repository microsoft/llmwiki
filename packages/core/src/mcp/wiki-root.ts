import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { WIKI_DIR_NAME } from '../constants.js';

/** Raised when a tool needs a wiki but the server has not located one yet. */
export class NoWikiError extends Error {
  constructor() {
    super(
      'No LLM Wiki is open. Call wiki_open with the absolute path of the project folder ' +
        `that contains the ${WIKI_DIR_NAME} directory (usually the current working directory), ` +
        'or wiki_init to create a new wiki there.',
    );
    this.name = 'NoWikiError';
  }
}

function isWikiRoot(dir: string): boolean {
  return existsSync(join(dir, 'wiki', 'index.md'));
}

/**
 * Resolve the wiki root for `dir`, which may be a project folder containing
 * `.wiki/` or the `.wiki` folder itself. Returns `undefined` if neither holds
 * an initialized wiki (`wiki/index.md`).
 */
export function findWikiRoot(dir: string): string | undefined {
  const abs = resolve(dir);
  const nested = join(abs, WIKI_DIR_NAME);
  if (isWikiRoot(nested)) return nested;
  if (basename(abs) === WIKI_DIR_NAME && isWikiRoot(abs)) return abs;
  return undefined;
}

export type WikiRootSource = 'config' | 'cwd' | 'roots' | 'open';

export interface WikiRootStateOptions {
  /** Wiki root fixed by configuration (CLI argument or LLMWIKI_ROOT). */
  fixed?: string;
  /** Directory to check for `.wiki/` when no root is fixed. */
  cwd?: string;
}

/**
 * Tracks which wiki the MCP server operates on.
 *
 * With a fixed root (the VS Code extension passes one) nothing else applies.
 * Otherwise `<cwd>/.wiki` is used when it exists at startup; if not, the root
 * is discovered on the first tool call from the client's workspace roots (and
 * the working directory again, in case a wiki was created since). Agents can
 * also choose one explicitly with `wiki_open` / `wiki_init`: agent plugins
 * start servers in the plugin folder, and some clients report no roots.
 */
export class WikiRootState {
  readonly isFixed: boolean;
  private root: string | undefined;
  private source: WikiRootSource | undefined;
  private readonly cwd: string | undefined;

  constructor(options: WikiRootStateOptions) {
    this.isFixed = options.fixed !== undefined;
    this.cwd = options.cwd;
    if (options.fixed !== undefined) {
      this.set(resolve(options.fixed), 'config');
    } else if (options.cwd) {
      const found = findWikiRoot(options.cwd);
      if (found) this.set(found, 'cwd');
    }
  }

  /** The wiki root located so far, if any. */
  get current(): string | undefined {
    return this.root;
  }

  /** Forget a root discovered from client roots when the client's roots change. */
  attach(server: Server): void {
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      if (this.source === 'roots') {
        this.root = undefined;
        this.source = undefined;
      }
    });
  }

  /** Return the active wiki root, discovering it if needed. */
  async require(server: Server): Promise<string> {
    if (this.root) return this.root;

    for (const folder of await this.workspaceFolders(server)) {
      const found = findWikiRoot(folder);
      if (found) return this.set(found, 'roots');
    }

    if (this.cwd) {
      const found = findWikiRoot(this.cwd);
      if (found) return this.set(found, 'cwd');
    }

    throw new NoWikiError();
  }

  /** Absolute paths of the client's `file://` workspace roots (empty if unsupported). */
  async workspaceFolders(server: Server): Promise<string[]> {
    if (!server.getClientCapabilities()?.roots) return [];
    try {
      const { roots } = await server.listRoots();
      return roots
        .filter((r) => r.uri.startsWith('file:'))
        .map((r) => fileURLToPath(r.uri));
    } catch {
      return [];
    }
  }

  /** Select a wiki explicitly. Throws if `dir` holds no initialized wiki. */
  open(dir: string): string {
    const found = findWikiRoot(dir);
    if (!found) {
      throw new Error(
        `No LLM Wiki found at ${resolve(dir)} (expected ${WIKI_DIR_NAME}/wiki/index.md). Use wiki_init to create one.`,
      );
    }
    if (this.isFixed && found !== this.root) {
      throw new Error(`This LLM Wiki server is bound to ${this.root} by its configuration.`);
    }
    return this.set(found, 'open');
  }

  private set(root: string, source: WikiRootSource): string {
    this.root = root;
    this.source = source;
    return root;
  }
}

/**
 * Wiki discovery for servers started without a wiki root (agent plugins,
 * `llmwiki-mcp` with no argument): cwd, client roots, wiki_open, wiki_init.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../../packages/core/src/mcp/server.js';
import { findWikiRoot } from '../../../packages/core/src/mcp/wiki-root.js';
import { initWiki } from '../../../packages/core/src/init.js';
import { writePage } from '../../../packages/core/src/wiki.js';
import { addEntry, readIndex } from '../../../packages/core/src/index-ops.js';

let base: string;
let projectA: string;
let projectB: string;
let emptyDir: string;

async function makeWiki(project: string, title: string) {
  await initWiki(project);
  const wikiDir = join(project, '.wiki', 'wiki');
  await writePage(join(wikiDir, 'concepts', 'topic.md'), {
    frontmatter: { type: 'concept', title, tags: [], created: '2026-01-01' },
    body: `${title} body.`,
  });
  await addEntry(join(wikiDir, 'index.md'), {
    path: 'concepts/topic.md',
    title,
    summary: '',
    category: 'Concepts',
    tags: [],
  });
}

async function connect(
  cwd: string,
  roots?: { current: string[] },
): Promise<Client> {
  const server = createMcpServer({ cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    roots ? { capabilities: { roots: { listChanged: true } } } : undefined,
  );
  if (roots) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: roots.current.map((dir) => ({ uri: pathToFileURL(dir).href })),
    }));
  }
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0].text;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { text, parsed, isError: result.isError === true };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mcp-discovery-'));
  projectA = join(base, 'project-a');
  projectB = join(base, 'project-b');
  emptyDir = join(base, 'plugin-root');
  await makeWiki(projectA, 'Alpha');
  await makeWiki(projectB, 'Beta');
  await initWiki(emptyDir); // creates the folder…
  await rm(join(emptyDir, '.wiki'), { recursive: true, force: true }); // …without a wiki
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('findWikiRoot', () => {
  it('accepts a project folder or its .wiki folder', () => {
    expect(findWikiRoot(projectA)).toBe(join(projectA, '.wiki'));
    expect(findWikiRoot(join(projectA, '.wiki'))).toBe(join(projectA, '.wiki'));
  });

  it('rejects folders without an initialized wiki', () => {
    expect(findWikiRoot(emptyDir)).toBeUndefined();
    expect(findWikiRoot(join(base, 'does-not-exist'))).toBeUndefined();
  });

  it('accepts a wiki whose index.md is missing, like wiki_init does', async () => {
    await rm(join(projectA, '.wiki', 'wiki', 'index.md'));
    expect(findWikiRoot(projectA)).toBe(join(projectA, '.wiki'));
  });
});

describe('Discovery mode', () => {
  it('lists wiki_open and wiki_init in addition to the wiki tools', async () => {
    const client = await connect(emptyDir);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('wiki_open');
    expect(names).toContain('wiki_init');
    expect(names).toHaveLength(18);
  });

  it('uses <cwd>/.wiki when present', async () => {
    const client = await connect(projectA);
    const { parsed, isError } = await call(client, 'wiki_query', { query: 'alpha' });
    expect(isError).toBe(false);
    expect(parsed.results[0].title).toBe('Alpha');
  });

  it('explains how to open a wiki when none is found', async () => {
    const client = await connect(emptyDir);
    const { text, isError } = await call(client, 'wiki_status');
    expect(isError).toBe(true);
    expect(text).toContain('No LLM Wiki is open');
    expect(text).toContain('wiki_open');
  });

  it('fails resource reads with the same guidance', async () => {
    const client = await connect(emptyDir);
    await expect(client.readResource({ uri: 'resource://wiki/index' })).rejects.toThrow(/No LLM Wiki is open/);
  });

  it('wiki_open selects a wiki for the session', async () => {
    const client = await connect(emptyDir);
    const opened = await call(client, 'wiki_open', { path: projectB });
    expect(opened.isError).toBe(false);
    expect(opened.parsed).toMatchObject({ status: 'opened', wiki_root: join(projectB, '.wiki'), wiki_page_count: 1 });

    const { parsed } = await call(client, 'wiki_query', { query: 'beta' });
    expect(parsed.results[0].title).toBe('Beta');
  });

  it('wiki_open rejects relative paths and folders without a wiki', async () => {
    const client = await connect(emptyDir);
    const relative = await call(client, 'wiki_open', { path: 'project-a' });
    expect(relative.isError).toBe(true);
    expect(relative.text).toContain('absolute path');

    const missing = await call(client, 'wiki_open', { path: emptyDir });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('Use wiki_init');
  });

  it('wiki_init creates and opens a wiki at an explicit path', async () => {
    const client = await connect(emptyDir);
    const target = join(base, 'new-project');

    const { parsed, isError } = await call(client, 'wiki_init', { path: target });

    expect(isError).toBe(false);
    expect(parsed.status).toBe('created');
    expect(parsed.wiki_root).toBe(join(target, '.wiki'));
    expect(existsSync(join(target, '.wiki', 'wiki', 'index.md'))).toBe(true);
    expect(existsSync(join(target, '.wiki', 'AGENTS.md'))).toBe(true);

    const status = await call(client, 'wiki_status');
    expect(status.isError).toBe(false);

    const again = await call(client, 'wiki_init', { path: target });
    expect(again.parsed.status).toBe('already_initialized');
  });

  it('wiki_init needs a path when the client reports no workspace folders', async () => {
    const client = await connect(emptyDir);
    const { text, isError } = await call(client, 'wiki_init');
    expect(isError).toBe(true);
    expect(text).toContain("Pass 'path'");
    expect(existsSync(join(emptyDir, '.wiki'))).toBe(false);
  });

  it('opens a wiki whose index.md is missing so wiki_fix can rebuild the index', async () => {
    const indexPath = join(projectB, '.wiki', 'wiki', 'index.md');
    await rm(indexPath);
    const client = await connect(emptyDir);

    const opened = await call(client, 'wiki_open', { path: projectB });
    expect(opened.isError).toBe(false);
    const init = await call(client, 'wiki_init', { path: projectB });
    expect(init.isError).toBe(false);
    expect(init.parsed.status).toBe('already_initialized');

    const fix = await call(client, 'wiki_fix');
    expect(fix.isError).toBe(false);
    expect((await readIndex(indexPath)).map((e) => e.path)).toEqual(['concepts/topic.md']);
  });
});

describe('Discovery from client roots', () => {
  it('finds the wiki in a workspace root', async () => {
    const client = await connect(emptyDir, { current: [emptyDir, projectA] });
    const { parsed, isError } = await call(client, 'wiki_query', { query: 'alpha' });
    expect(isError).toBe(false);
    expect(parsed.results[0].title).toBe('Alpha');
  });

  it('re-discovers after the client reports changed roots', async () => {
    const roots = { current: [projectA] };
    const client = await connect(emptyDir, roots);
    expect((await call(client, 'wiki_query', { query: 'alpha' })).parsed.matches).toBe(1);

    roots.current = [projectB];
    await client.sendRootsListChanged();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { parsed } = await call(client, 'wiki_query', { query: 'beta' });
    expect(parsed.results[0].title).toBe('Beta');
  });

  it('wiki_init defaults to the first workspace root', async () => {
    const workspace = join(base, 'workspace');
    const client = await connect(emptyDir, { current: [workspace] });
    await initWiki(workspace);
    await rm(join(workspace, '.wiki'), { recursive: true, force: true });

    const { parsed, isError } = await call(client, 'wiki_init');

    expect(isError).toBe(false);
    expect(parsed.wiki_root).toBe(join(workspace, '.wiki'));
  });
});

describe('Bound mode', () => {
  it('rejects wiki_open and wiki_init as unknown tools', async () => {
    const server = createMcpServer(join(projectA, '.wiki'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { text, isError } = await call(client, 'wiki_open', { path: projectB });
    expect(isError).toBe(true);
    expect(text).toContain('Unknown tool: wiki_open');
  });
});

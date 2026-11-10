import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/core/src/mcp/server.js';
import { initWiki } from '../../../packages/core/src/init.js';
import { writePage } from '../../../packages/core/src/wiki.js';
import { writeIndex } from '../../../packages/core/src/index-ops.js';

let projectDir: string;
let client: Client;

async function connect(options: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await c.connect(clientTransport);
  return c;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mcp-complete-'));
  await initWiki(projectDir);
  const wikiRoot = join(projectDir, '.wiki');
  const wikiDir = join(wikiRoot, 'wiki');
  for (const [path, title] of [
    ['concepts/attention.md', 'Attention'],
    ['concepts/transformers.md', 'Transformers'],
    ['entities/turing.md', 'Alan Turing'],
  ]) {
    await writePage(join(wikiDir, path), { frontmatter: { type: 'concept', title }, body: title });
  }
  await writeIndex(join(wikiDir, 'index.md'), [
    { path: 'concepts/attention.md', title: 'Attention', summary: '', category: 'Concepts', tags: [] },
    { path: 'concepts/transformers.md', title: 'Transformers', summary: '', category: 'Concepts', tags: [] },
    { path: 'entities/turing.md', title: 'Alan Turing', summary: '', category: 'Entities', tags: [] },
  ]);
  await mkdir(join(wikiRoot, 'raw', 'papers'), { recursive: true });
  await writeFile(join(wikiRoot, 'raw', 'papers', 'attention.pdf'), 'pdf');
  await writeFile(join(wikiRoot, 'raw', 'notes.md'), 'notes');

  client = await connect(wikiRoot);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('Completions', () => {
  it('suggests page paths for resource://wiki/pages/{path}', async () => {
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'resource://wiki/pages/{path}' },
      argument: { name: 'path', value: 'con' },
    });
    expect(result.completion.values).toEqual(['concepts/attention.md', 'concepts/transformers.md']);
    expect(result.completion.hasMore).toBe(false);
  });

  it('never suggests index.md or log.md', async () => {
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'resource://wiki/pages/{path}' },
      argument: { name: 'path', value: '' },
    });
    expect(result.completion.values).not.toContain('index.md');
    expect(result.completion.values).not.toContain('log.md');
    expect(result.completion.total).toBe(3);
  });

  it('suggests raw paths for resource://wiki/sources/{path}', async () => {
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'resource://wiki/sources/{path}' },
      argument: { name: 'path', value: 'ATT' },
    });
    expect(result.completion.values).toEqual(['papers/attention.pdf']);
  });

  it('suggests raw/ paths for the ingest-and-integrate prompt', async () => {
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'ingest-and-integrate' },
      argument: { name: 'source_path', value: '' },
    });
    expect(result.completion.values).toEqual(['raw/notes.md', 'raw/papers/attention.pdf']);
  });

  it('suggests index titles for the research-topic prompt', async () => {
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'research-topic' },
      argument: { name: 'topic', value: 'tur' },
    });
    expect(result.completion.values).toEqual(['Alan Turing']);
  });

  it('returns nothing for unknown references', async () => {
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'lint-and-fix' },
      argument: { name: 'anything', value: '' },
    });
    expect(result.completion.values).toEqual([]);
  });

  it('returns nothing before a wiki is located', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mcp-complete-empty-'));
    try {
      const discoveryClient = await connect({ cwd: empty });
      const result = await discoveryClient.complete({
        ref: { type: 'ref/resource', uri: 'resource://wiki/pages/{path}' },
        argument: { name: 'path', value: '' },
      });
      expect(result.completion.values).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

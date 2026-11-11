/**
 * MCP server metadata: tool titles/annotations, structured output, server
 * info, capabilities and instructions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type CreateMcpServerOptions } from '../../../packages/core/src/mcp/server.js';
import { READ_TOOLS } from '../../../packages/core/src/mcp/read-tools.js';
import { WRITE_TOOLS } from '../../../packages/core/src/mcp/write-tools.js';
import { WORKSPACE_TOOLS } from '../../../packages/core/src/mcp/workspace-tools.js';
import { BASE_INSTRUCTIONS, MAX_SCHEMA_CHARS } from '../../../packages/core/src/mcp/instructions.js';
import { initWiki } from '../../../packages/core/src/init.js';
import { writePage } from '../../../packages/core/src/wiki.js';
import { CORE_VERSION } from '../../../packages/core/src/constants.js';

let projectDir: string;
let wikiRoot: string;

async function connect(options: string | CreateMcpServerOptions): Promise<Client> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mcp-meta-'));
  await initWiki(projectDir);
  wikiRoot = join(projectDir, '.wiki');
  await writePage(join(wikiRoot, 'wiki', 'concepts', 'ai.md'), {
    frontmatter: { type: 'concept', title: 'Artificial Intelligence', tags: ['ai'], created: '2026-01-01' },
    body: 'Artificial intelligence and [a missing page](missing.md).',
  });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('Tool metadata', () => {
  it('gives every tool a title and annotations', () => {
    for (const tool of [...READ_TOOLS, ...WRITE_TOOLS, ...WORKSPACE_TOOLS]) {
      expect(tool.title, tool.name).toMatch(/\S/);
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
    }
  });

  it('marks read tools read-only and write tools not', () => {
    for (const tool of READ_TOOLS) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
    }
    for (const tool of WRITE_TOOLS) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
    }
  });

  it('flags tools that overwrite or delete content as destructive', () => {
    const byName = new Map(WRITE_TOOLS.map((t) => [t.name, t.annotations]));
    for (const name of ['wiki_write_page', 'wiki_update_page', 'wiki_delete_page', 'wiki_fix', 'wiki_create_entity']) {
      expect(byName.get(name)?.destructiveHint, name).toBe(true);
    }
    expect(byName.get('wiki_add_crosslinks')?.destructiveHint).toBe(false);
    expect(byName.get('wiki_add_crosslinks')?.idempotentHint).toBe(true);
  });

  it('serves titles and annotations through tools/list', async () => {
    const client = await connect(wikiRoot);
    const { tools } = await client.listTools();
    const query = tools.find((t) => t.name === 'wiki_query');
    expect(query?.title).toBe('Search wiki');
    expect(query?.annotations?.readOnlyHint).toBe(true);
    const del = tools.find((t) => t.name === 'wiki_delete_page');
    expect(del?.annotations?.destructiveHint).toBe(true);
  });
});

describe('Structured tool output', () => {
  it.each([
    ['wiki_status', {}],
    ['wiki_query', { query: 'intelligence' }],
    ['wiki_lint', {}],
    ['wiki_fix', { dryRun: true }],
  ])('%s returns structuredContent that matches its text and outputSchema', async (name, args) => {
    const client = await connect(wikiRoot);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === name)?.outputSchema).toBeDefined();

    // The SDK client validates structuredContent against the cached outputSchema.
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.structuredContent).toEqual(JSON.parse(text));
  });

  it('omits structuredContent for tools without an outputSchema', async () => {
    const client = await connect(wikiRoot);
    const result = await client.callTool({ name: 'wiki_read_index', arguments: {} });
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('Server info and capabilities', () => {
  it('reports name, title, version, website and icon', async () => {
    const client = await connect(wikiRoot);
    const info = client.getServerVersion();
    expect(info?.name).toBe('llmwiki');
    expect(info?.title).toBe('LLM Wiki');
    expect(info?.version).toBe(CORE_VERSION);
    expect(info?.websiteUrl).toBe('https://github.com/microsoft/llmwiki');
    expect(info?.icons?.[0]?.src).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('keeps CORE_VERSION in sync with packages/core/package.json', async () => {
    const pkg = JSON.parse(await readFile(join(__dirname, '../../../packages/core/package.json'), 'utf-8'));
    expect(CORE_VERSION).toBe(pkg.version);
  });

  it('advertises completions alongside tools, resources and prompts', async () => {
    const client = await connect(wikiRoot);
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
    expect(caps?.prompts).toBeDefined();
    expect(caps?.completions).toBeDefined();
  });
});

describe('Server instructions', () => {
  it('include the usage guidance and the wiki AGENTS.md schema', async () => {
    const client = await connect(wikiRoot);
    const instructions = client.getInstructions() ?? '';
    expect(instructions.startsWith(BASE_INSTRUCTIONS)).toBe(true);
    expect(instructions).toContain('wiki_query');
    expect(instructions).toContain("This wiki's schema (.wiki/AGENTS.md)");
    expect(instructions).toContain('### Page Types');
    // Bound servers have no wiki_open, so they do not mention it.
    expect(instructions).not.toContain('wiki_open');
  });

  it('truncate a very large AGENTS.md', async () => {
    await writeFile(join(wikiRoot, 'AGENTS.md'), `# Schema\n\n${'x'.repeat(MAX_SCHEMA_CHARS * 2)}`);
    const client = await connect(wikiRoot);
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('[Truncated. Read .wiki/AGENTS.md for the full schema.]');
    expect(instructions.length).toBeLessThan(BASE_INSTRUCTIONS.length + MAX_SCHEMA_CHARS + 500);
  });

  it('work without an AGENTS.md', async () => {
    await rm(join(wikiRoot, 'AGENTS.md'));
    const client = await connect(wikiRoot);
    expect(client.getInstructions()).toBe(BASE_INSTRUCTIONS);
  });

  it('explain how to open a wiki when the server discovers it', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mcp-meta-empty-'));
    try {
      const client = await connect({ cwd: empty });
      const instructions = client.getInstructions() ?? '';
      expect(instructions).toContain('wiki_open');
      expect(instructions).not.toContain("This wiki's schema");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

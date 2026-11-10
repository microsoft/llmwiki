/**
 * End-to-end check of the committed plugin server bundle over real stdio,
 * the way an agent plugin client starts it (`node server/llmwiki-mcp.cjs`
 * from the plugin folder, no wiki-root argument).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { initWiki } from '../../packages/core/src/init.js';
import { CORE_VERSION } from '../../packages/core/src/constants.js';

const PLUGIN = join(__dirname, '../../plugin');
const BUNDLE = join(PLUGIN, 'server', 'llmwiki-mcp.cjs');

let base: string;
let project: string;

async function startServer(options: { cwd: string; args?: string[]; env?: Record<string, string> }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE, ...(options.args ?? [])],
    cwd: options.cwd,
    env: { ...(process.env as Record<string, string>), ...options.env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0].text;
  return { text, isError: result.isError === true, structured: result.structuredContent as any };
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'plugin-stdio-'));
  project = join(base, 'project');
  await initWiki(project);
  await writeFile(join(project, '.wiki', 'raw', 'turing.md'), '# Alan Turing\n\nAlan Turing proposed the Turing machine.');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('plugin server bundle (stdio)', () => {
  it('exists', () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('starts in the plugin folder, opens a wiki and works end to end', async () => {
    const client = await startServer({ cwd: PLUGIN });
    try {
      expect(client.getServerVersion()?.version).toBe(CORE_VERSION);
      expect(client.getInstructions()).toContain('wiki_open');

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['wiki_open', 'wiki_init', 'wiki_fix']));
      expect(tools.find((t) => t.name === 'wiki_read_page')?.annotations?.readOnlyHint).toBe(true);

      const before = await call(client, 'wiki_status');
      expect(before.isError).toBe(true);
      expect(before.text).toContain('No LLM Wiki is open');

      const opened = await call(client, 'wiki_open', { path: project });
      expect(opened.isError).toBe(false);

      const ingested = await call(client, 'wiki_ingest_with_context', { sourcePath: 'raw/turing.md' });
      expect(ingested.isError).toBe(false);
      expect(existsSync(join(project, '.wiki', 'wiki', 'sources', 'turing-summary.md'))).toBe(true);

      const status = await call(client, 'wiki_status');
      expect(status.isError).toBe(false);
      expect(status.structured.source_count).toBe(1);

      const fix = await call(client, 'wiki_fix', { dryRun: true });
      expect(fix.structured.dry_run).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('binds to an explicit wiki root and includes its AGENTS.md', async () => {
    const client = await startServer({ cwd: base, args: [join(project, '.wiki')] });
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain('wiki_open');
      expect(client.getInstructions()).toContain("This wiki's schema (.wiki/AGENTS.md)");
      expect((await call(client, 'wiki_status')).isError).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('honors LLMWIKI_ROOT', async () => {
    const client = await startServer({ cwd: PLUGIN, env: { LLMWIKI_ROOT: join(project, '.wiki') } });
    try {
      expect((await call(client, 'wiki_status')).isError).toBe(false);
    } finally {
      await client.close();
    }
  });
});

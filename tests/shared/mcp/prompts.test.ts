/**
 * MCP Prompts Tests
 *
 * Tests the prompt registration for reusable workflow templates:
 *   - ListPrompts returns all 3 prompt templates with correct metadata
 *   - GetPrompt returns correct messages for each prompt
 *   - GetPrompt rejects unknown prompt names
 *   - GetPrompt validates required arguments
 *   - Prompt messages reference correct MCP tools
 *   - Prompts capability is advertised by the server
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/shared/src/mcp/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let wikiRoot: string;
let client: Client;

async function setupWikiStructure() {
  wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-prompts-'));
  await mkdir(join(wikiRoot, 'wiki'), { recursive: true });
  await mkdir(join(wikiRoot, 'raw'), { recursive: true });
}

async function connectClient(root: string): Promise<Client> {
  const server = createMcpServer(root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const c = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: { prompts: {} } },
  );

  await server.connect(serverTransport);
  await c.connect(clientTransport);

  return c;
}

// ---------------------------------------------------------------------------
// Test Suite: ListPrompts
// ---------------------------------------------------------------------------

describe('MCP Prompts — ListPrompts', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns exactly 3 prompt templates', async () => {
    const result = await client.listPrompts();
    expect(result.prompts).toHaveLength(3);
  });

  it('includes ingest-and-integrate prompt with source_path argument', async () => {
    const result = await client.listPrompts();
    const prompt = result.prompts.find((p) => p.name === 'ingest-and-integrate');
    expect(prompt).toBeDefined();
    expect(prompt!.description).toBeDefined();
    expect(prompt!.arguments).toHaveLength(1);
    expect(prompt!.arguments![0].name).toBe('source_path');
    expect(prompt!.arguments![0].required).toBe(true);
  });

  it('includes lint-and-fix prompt with no arguments', async () => {
    const result = await client.listPrompts();
    const prompt = result.prompts.find((p) => p.name === 'lint-and-fix');
    expect(prompt).toBeDefined();
    expect(prompt!.description).toBeDefined();
    expect(prompt!.arguments ?? []).toHaveLength(0);
  });

  it('includes research-topic prompt with topic argument', async () => {
    const result = await client.listPrompts();
    const prompt = result.prompts.find((p) => p.name === 'research-topic');
    expect(prompt).toBeDefined();
    expect(prompt!.description).toBeDefined();
    expect(prompt!.arguments).toHaveLength(1);
    expect(prompt!.arguments![0].name).toBe('topic');
    expect(prompt!.arguments![0].required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test Suite: GetPrompt — ingest-and-integrate
// ---------------------------------------------------------------------------

describe('MCP Prompts — GetPrompt ingest-and-integrate', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns messages referencing the multi-step ingest workflow', async () => {
    const result = await client.getPrompt({
      name: 'ingest-and-integrate',
      arguments: { source_path: 'notes/llm-paper.pdf' },
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    const allText = result.messages
      .map((m) => {
        const content = m.content;
        if ('text' in content) return content.text;
        return '';
      })
      .join('\n');

    expect(allText).toContain('wiki_ingest_with_context');
    expect(allText).toContain('wiki_create_entity');
    expect(allText).toContain('wiki_create_concept');
    expect(allText).toContain('wiki_add_crosslinks');
    expect(allText).toContain('wiki_lint');
    expect(allText).toContain('notes/llm-paper.pdf');
  });

  it('returns user role messages with text content type', async () => {
    const result = await client.getPrompt({
      name: 'ingest-and-integrate',
      arguments: { source_path: 'data/test.txt' },
    });
    for (const msg of result.messages) {
      expect(msg.role).toBe('user');
      expect(msg.content).toHaveProperty('type', 'text');
      expect(msg.content).toHaveProperty('text');
    }
  });

  it('has a description string', async () => {
    const result = await client.getPrompt({
      name: 'ingest-and-integrate',
      arguments: { source_path: 'papers/ai.pdf' },
    });
    expect(typeof result.description).toBe('string');
    expect(result.description!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test Suite: GetPrompt — lint-and-fix
// ---------------------------------------------------------------------------

describe('MCP Prompts — GetPrompt lint-and-fix', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns messages referencing lint workflow tools', async () => {
    const result = await client.getPrompt({
      name: 'lint-and-fix',
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    const allText = result.messages
      .map((m) => {
        const content = m.content;
        if ('text' in content) return content.text;
        return '';
      })
      .join('\n');

    expect(allText).toContain('wiki_lint');
    expect(allText).toMatch(/severity|error.*warning|warning.*error/i);
  });
});

// ---------------------------------------------------------------------------
// Test Suite: GetPrompt — research-topic
// ---------------------------------------------------------------------------

describe('MCP Prompts — GetPrompt research-topic', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns messages referencing research workflow tools and topic', async () => {
    const result = await client.getPrompt({
      name: 'research-topic',
      arguments: { topic: 'transformer architecture' },
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    const allText = result.messages
      .map((m) => {
        const content = m.content;
        if ('text' in content) return content.text;
        return '';
      })
      .join('\n');

    expect(allText).toContain('wiki_query');
    expect(allText).toContain('wiki_read_page');
    expect(allText).toContain('transformer architecture');
  });

  it('has a description mentioning the topic', async () => {
    const result = await client.getPrompt({
      name: 'research-topic',
      arguments: { topic: 'neural networks' },
    });
    expect(typeof result.description).toBe('string');
    expect(result.description).toContain('neural networks');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Error handling
// ---------------------------------------------------------------------------

describe('MCP Prompts — Error handling', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('rejects unknown prompt names', async () => {
    await expect(
      client.getPrompt({ name: 'nonexistent-prompt' }),
    ).rejects.toThrow();
  });

  it('rejects ingest-and-integrate when source_path is missing', async () => {
    await expect(
      client.getPrompt({ name: 'ingest-and-integrate' }),
    ).rejects.toThrow();
  });

  it('rejects research-topic when topic is missing', async () => {
    await expect(
      client.getPrompt({ name: 'research-topic' }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Server capabilities
// ---------------------------------------------------------------------------

describe('MCP Prompts — Server capabilities', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('server advertises prompts capability alongside tools and resources', async () => {
    // Prompts capability is validated because listPrompts would fail without it
    const prompts = await client.listPrompts();
    expect(prompts.prompts).toBeDefined();

    // Verify tools still work
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);

    // Verify resources still work
    const resources = await client.listResources();
    expect(resources.resources.length).toBeGreaterThan(0);
  });
});

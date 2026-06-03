/**
 * MCP Resources Tests
 *
 * Tests the resource registration for browsable wiki content:
 *   - ListResources returns static resource URIs
 *   - ListResourceTemplates returns template URIs
 *   - ReadResource for index, pages list, and sources list
 *   - ReadResource for individual pages and source files via templates
 *   - Path traversal protection
 *   - Error handling for unknown URIs and missing files
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/core/src/mcp/server.js';
import { writePage } from '../../../packages/core/src/wiki.js';
import { writeIndex } from '../../../packages/core/src/index-ops.js';
import type { IndexEntry } from '../../../packages/core/src/index-ops.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let wikiRoot: string;
let wikiDir: string;
let rawDir: string;
let indexPath: string;
let client: Client;

async function setupWikiStructure() {
  wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-res-'));
  wikiDir = join(wikiRoot, 'wiki');
  rawDir = join(wikiRoot, 'raw');
  indexPath = join(wikiDir, 'index.md');

  await mkdir(wikiDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'entities'), { recursive: true });
}

const seedEntries: IndexEntry[] = [
  {
    path: 'concepts/ai.md',
    title: 'Artificial Intelligence',
    summary: 'Overview of AI topics',
    category: 'Concepts',
    tags: ['ai', 'machine-learning'],
  },
  {
    path: 'entities/turing.md',
    title: 'Alan Turing',
    summary: 'Pioneer of computer science',
    category: 'Entities',
    tags: ['computer-science', 'mathematics'],
  },
];

async function seedWikiContent() {
  await writePage(join(wikiDir, 'concepts', 'ai.md'), {
    frontmatter: {
      type: 'concept',
      title: 'Artificial Intelligence',
      tags: ['ai', 'machine-learning'],
      created: '2026-01-15',
    },
    body: 'Artificial intelligence is the simulation of human intelligence by machines.',
  });

  await writePage(join(wikiDir, 'entities', 'turing.md'), {
    frontmatter: {
      type: 'entity',
      title: 'Alan Turing',
      tags: ['computer-science', 'mathematics'],
      created: '2026-01-20',
    },
    body: 'Alan Turing was a British mathematician and computer scientist.',
  });

  await writeIndex(indexPath, seedEntries);

  // Raw source files
  await writeFile(
    join(rawDir, 'test-source.txt'),
    'This is a test source document about AI.',
  );
  await mkdir(join(rawDir, 'nested'), { recursive: true });
  await writeFile(
    join(rawDir, 'nested', 'deep-source.md'),
    '# Deep Source\n\nNested source file content.',
  );
}

async function connectClient(root: string): Promise<Client> {
  const server = createMcpServer(root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const c = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: { resources: {} } },
  );

  await server.connect(serverTransport);
  await c.connect(clientTransport);

  return c;
}

// ---------------------------------------------------------------------------
// Test Suite: ListResources
// ---------------------------------------------------------------------------

describe('MCP Resources — ListResources', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns three static resource entries', async () => {
    const result = await client.listResources();
    expect(result.resources).toHaveLength(3);
  });

  it('includes wiki/index resource with correct metadata', async () => {
    const result = await client.listResources();
    const index = result.resources.find((r) => r.uri === 'resource://wiki/index');
    expect(index).toBeDefined();
    expect(index!.name).toBe('Wiki Index');
    expect(index!.mimeType).toBe('application/json');
  });

  it('includes wiki/pages resource with correct metadata', async () => {
    const result = await client.listResources();
    const pages = result.resources.find((r) => r.uri === 'resource://wiki/pages');
    expect(pages).toBeDefined();
    expect(pages!.name).toBe('Wiki Pages');
    expect(pages!.mimeType).toBe('application/json');
  });

  it('includes wiki/sources resource with correct metadata', async () => {
    const result = await client.listResources();
    const sources = result.resources.find((r) => r.uri === 'resource://wiki/sources');
    expect(sources).toBeDefined();
    expect(sources!.name).toBe('Wiki Sources');
    expect(sources!.mimeType).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: ListResourceTemplates
// ---------------------------------------------------------------------------

describe('MCP Resources — ListResourceTemplates', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('returns two resource templates', async () => {
    const result = await client.listResourceTemplates();
    expect(result.resourceTemplates).toHaveLength(2);
  });

  it('includes pages template with correct URI pattern', async () => {
    const result = await client.listResourceTemplates();
    const pages = result.resourceTemplates.find(
      (t) => t.uriTemplate === 'resource://wiki/pages/{path}',
    );
    expect(pages).toBeDefined();
    expect(pages!.name).toBe('Wiki Page');
    expect(pages!.mimeType).toBe('application/json');
  });

  it('includes sources template with correct URI pattern', async () => {
    const result = await client.listResourceTemplates();
    const sources = result.resourceTemplates.find(
      (t) => t.uriTemplate === 'resource://wiki/sources/{path}',
    );
    expect(sources).toBeDefined();
    expect(sources!.name).toBe('Source File');
    expect(sources!.mimeType).toBe('text/plain');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: ReadResource — static resources
// ---------------------------------------------------------------------------

describe('MCP Resources — ReadResource (static)', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('reads wiki/index and returns valid JSON with index entries', async () => {
    const result = await client.readResource({ uri: 'resource://wiki/index' });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const entries = JSON.parse(result.contents[0].text as string);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe('Artificial Intelligence');
    expect(entries[1].title).toBe('Alan Turing');
    expect(entries[0].tags).toContain('ai');
  });

  it('reads wiki/pages and returns all pages with frontmatter', async () => {
    const result = await client.readResource({ uri: 'resource://wiki/pages' });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const pages = JSON.parse(result.contents[0].text as string) as Array<{
      path: string;
      frontmatter: Record<string, unknown>;
    }>;
    expect(pages.length).toBeGreaterThanOrEqual(2);

    // Find the AI concept page (paths use forward slashes)
    const aiPage = pages.find((p) => p.path.includes('concepts/ai.md'));
    expect(aiPage).toBeDefined();
    expect(aiPage!.frontmatter.title).toBe('Artificial Intelligence');

    // Find the Turing entity page
    const turingPage = pages.find((p) => p.path.includes('entities/turing.md'));
    expect(turingPage).toBeDefined();
    expect(turingPage!.frontmatter.title).toBe('Alan Turing');
  });

  it('reads wiki/sources and returns source file metadata', async () => {
    const result = await client.readResource({ uri: 'resource://wiki/sources' });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const sources = JSON.parse(result.contents[0].text as string) as Array<{
      name: string;
      path: string;
      size: number;
    }>;
    expect(sources.length).toBeGreaterThanOrEqual(2);

    const txt = sources.find((s) => s.name === 'test-source.txt');
    expect(txt).toBeDefined();
    expect(txt!.size).toBeGreaterThan(0);

    const nested = sources.find((s) => s.name === 'deep-source.md');
    expect(nested).toBeDefined();
    expect(nested!.path).toBe('nested/deep-source.md');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: ReadResource — template resources (individual pages / sources)
// ---------------------------------------------------------------------------

describe('MCP Resources — ReadResource (templates)', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('reads a single wiki page by path with frontmatter and body', async () => {
    const result = await client.readResource({
      uri: 'resource://wiki/pages/concepts/ai.md',
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const page = JSON.parse(result.contents[0].text as string);
    expect(page.frontmatter.title).toBe('Artificial Intelligence');
    expect(page.frontmatter.tags).toContain('ai');
    expect(page.body).toContain('simulation of human intelligence');
  });

  it('reads a source file and returns plain text content', async () => {
    const result = await client.readResource({
      uri: 'resource://wiki/sources/test-source.txt',
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toBe(
      'This is a test source document about AI.',
    );
  });

  it('reads a nested source file by path', async () => {
    const result = await client.readResource({
      uri: 'resource://wiki/sources/nested/deep-source.md',
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].text).toContain('# Deep Source');
    expect(result.contents[0].text).toContain('Nested source file content.');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Path traversal protection
// ---------------------------------------------------------------------------

describe('MCP Resources — Path traversal protection', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('rejects path traversal in page reads', async () => {
    await expect(
      client.readResource({
        uri: 'resource://wiki/pages/../../etc/passwd',
      }),
    ).rejects.toThrow();
  });

  it('rejects path traversal in source reads', async () => {
    await expect(
      client.readResource({
        uri: 'resource://wiki/sources/../../../etc/passwd',
      }),
    ).rejects.toThrow();
  });

  it('rejects encoded path traversal in page reads', async () => {
    await expect(
      client.readResource({
        uri: 'resource://wiki/pages/..%2F..%2Fetc%2Fpasswd',
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Error handling
// ---------------------------------------------------------------------------

describe('MCP Resources — Error handling', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('throws for unknown resource URIs', async () => {
    await expect(
      client.readResource({ uri: 'resource://wiki/unknown' }),
    ).rejects.toThrow();
  });

  it('throws when reading a non-existent wiki page', async () => {
    await expect(
      client.readResource({
        uri: 'resource://wiki/pages/concepts/nonexistent.md',
      }),
    ).rejects.toThrow();
  });

  it('throws when reading a non-existent source file', async () => {
    await expect(
      client.readResource({
        uri: 'resource://wiki/sources/missing-file.txt',
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Server capabilities
// ---------------------------------------------------------------------------

describe('MCP Resources — Server capabilities', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('server advertises resources capability', async () => {
    // Verify resources work end-to-end (the capability is implicitly
    // validated because listResources would fail without it)
    const result = await client.listResources();
    expect(result.resources).toBeDefined();
    expect(result.resources.length).toBeGreaterThan(0);
  });

  it('tools still work alongside resources', async () => {
    // Ensure adding resources did not break existing tool functionality
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain('wiki_status');
    expect(toolNames).toContain('wiki_list_pages');
  });
});

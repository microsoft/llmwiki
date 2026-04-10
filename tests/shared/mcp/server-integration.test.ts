/**
 * MCP Server Integration Tests
 *
 * Tests the full MCP server via InMemoryTransport (client ↔ server),
 * covering all read-only tools, write tools, error cases,
 * and one E2E subprocess test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/shared/src/mcp/server.js';
import { writePage, readPage } from '../../../packages/shared/src/wiki.js';
import { writeIndex, readIndex, addEntry } from '../../../packages/shared/src/index-ops.js';
import type { IndexEntry } from '../../../packages/shared/src/index-ops.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let wikiRoot: string;
let wikiDir: string;
let rawDir: string;
let indexPath: string;
let client: Client;

async function setupWikiStructure() {
  wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-integ-'));
  wikiDir = join(wikiRoot, 'wiki');
  rawDir = join(wikiRoot, 'raw');
  indexPath = join(wikiDir, 'index.md');

  await mkdir(wikiDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'entities'), { recursive: true });
}

async function seedWikiContent() {
  // Create some wiki pages
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

  // Create index
  await writeIndex(indexPath, [
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
  ]);

  // Create a raw source file
  await writeFile(
    join(rawDir, 'test-source.txt'),
    'This is a test source document about artificial intelligence and machine learning.',
  );

  // Create log.md so status can parse it
  await writeFile(join(wikiDir, 'log.md'), '');
}

async function connectClient(root: string): Promise<Client> {
  const server = createMcpServer(root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const c = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await c.connect(clientTransport);

  return c;
}

/** Call a tool and return the parsed JSON result. */
async function callTool(
  c: Client,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; parsed: unknown; isError?: boolean }> {
  const result = await c.callTool({ name: toolName, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content).toBeDefined();
  expect(content.length).toBeGreaterThanOrEqual(1);
  const text = content[0].text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { text, parsed, isError: result.isError as boolean | undefined };
}

// ---------------------------------------------------------------------------
// Test Suite: Read-only tools via InMemoryTransport
// ---------------------------------------------------------------------------

describe('MCP Server — Read Tools (InMemoryTransport)', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // listTools
  // -----------------------------------------------------------------------

  it('should list all registered tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    // All 7 read tools
    expect(names).toContain('wiki_status');
    expect(names).toContain('wiki_query');
    expect(names).toContain('wiki_lint');
    expect(names).toContain('wiki_list_pages');
    expect(names).toContain('wiki_list_sources');
    expect(names).toContain('wiki_read_page');
    expect(names).toContain('wiki_read_index');

    // All 7 write tools
    expect(names).toContain('wiki_write_page');
    expect(names).toContain('wiki_update_page');
    expect(names).toContain('wiki_create_entity');
    expect(names).toContain('wiki_create_concept');
    expect(names).toContain('wiki_add_crosslinks');
    expect(names).toContain('wiki_update_index');
    expect(names).toContain('wiki_ingest_with_context');

    expect(result.tools.length).toBe(14);
  });

  // -----------------------------------------------------------------------
  // wiki_status
  // -----------------------------------------------------------------------

  it('wiki_status returns valid StatusResult', async () => {
    const { parsed } = await callTool(client, 'wiki_status');
    const status = parsed as Record<string, unknown>;

    expect(status.command).toBe('status');
    expect(status.api_version).toBeDefined();
    expect(typeof status.source_count).toBe('number');
    expect(typeof status.wiki_page_count).toBe('number');
    expect(typeof status.orphan_page_count).toBe('number');
    expect(typeof status.index_coverage_pct).toBe('number');
    // We have 1 raw source and 2 wiki pages
    expect(status.source_count).toBe(1);
    expect(status.wiki_page_count).toBe(2);
  });

  // -----------------------------------------------------------------------
  // wiki_query
  // -----------------------------------------------------------------------

  it('wiki_query returns results for known terms', async () => {
    const { parsed } = await callTool(client, 'wiki_query', { query: 'artificial intelligence' });
    const result = parsed as Record<string, unknown>;

    expect(result.command).toBe('query');
    expect(result.api_version).toBeDefined();
    expect(typeof result.matches).toBe('number');
    expect(result.matches).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.results)).toBe(true);

    const results = result.results as Array<Record<string, unknown>>;
    const paths = results.map((r) => r.path);
    expect(paths).toContain('concepts/ai.md');
  });

  it('wiki_query returns empty results for non-matching terms', async () => {
    const { parsed } = await callTool(client, 'wiki_query', { query: 'xyznonexistent999' });
    const result = parsed as Record<string, unknown>;
    expect(result.matches).toBe(0);
    expect(result.results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // wiki_lint
  // -----------------------------------------------------------------------

  it('wiki_lint returns findings', async () => {
    const { parsed } = await callTool(client, 'wiki_lint');
    const result = parsed as Record<string, unknown>;

    expect(result.command).toBe('lint');
    expect(result.api_version).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.errorCount).toBe('number');
    expect(typeof result.warningCount).toBe('number');
    expect(typeof result.infoCount).toBe('number');
    expect(typeof result.categorySummary).toBe('object');
  });

  it('wiki_lint with category filter still returns valid structure', async () => {
    const { parsed } = await callTool(client, 'wiki_lint', { category: 'frontmatter' });
    const result = parsed as Record<string, unknown>;
    expect(result.command).toBe('lint');
    expect(Array.isArray(result.findings)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // wiki_list_pages
  // -----------------------------------------------------------------------

  it('wiki_list_pages returns array of pages with metadata', async () => {
    const { parsed } = await callTool(client, 'wiki_list_pages');
    const pages = parsed as Array<Record<string, unknown>>;

    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThanOrEqual(2);

    // Each page should have path and frontmatter
    for (const page of pages) {
      expect(page.path).toBeDefined();
      expect(page.frontmatter).toBeDefined();
    }
  });

  // -----------------------------------------------------------------------
  // wiki_list_sources
  // -----------------------------------------------------------------------

  it('wiki_list_sources returns array of source files', async () => {
    const { parsed } = await callTool(client, 'wiki_list_sources');
    const sources = parsed as Array<Record<string, unknown>>;

    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBe(1);
    expect(sources[0].name).toBe('test-source.txt');
    expect(typeof sources[0].size).toBe('number');
    expect(typeof sources[0].modified).toBe('string');
    expect(sources[0].extension).toBe('.txt');
  });

  // -----------------------------------------------------------------------
  // wiki_read_page
  // -----------------------------------------------------------------------

  it('wiki_read_page returns page content for valid path', async () => {
    const { parsed } = await callTool(client, 'wiki_read_page', { path: 'concepts/ai.md' });
    const page = parsed as Record<string, unknown>;

    expect(page.frontmatter).toBeDefined();
    expect(page.body).toBeDefined();
    const fm = page.frontmatter as Record<string, unknown>;
    expect(fm.title).toBe('Artificial Intelligence');
    expect(fm.type).toBe('concept');
    expect(page.body).toContain('simulation of human intelligence');
  });

  it('wiki_read_page returns error for nonexistent page', async () => {
    const { isError, text } = await callTool(client, 'wiki_read_page', {
      path: 'nonexistent.md',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Error');
  });

  // -----------------------------------------------------------------------
  // wiki_read_index
  // -----------------------------------------------------------------------

  it('wiki_read_index returns index entries', async () => {
    const { parsed } = await callTool(client, 'wiki_read_index');
    const entries = parsed as Array<Record<string, unknown>>;

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(2);

    const titles = entries.map((e) => e.title);
    expect(titles).toContain('Artificial Intelligence');
    expect(titles).toContain('Alan Turing');

    for (const entry of entries) {
      expect(entry.path).toBeDefined();
      expect(entry.title).toBeDefined();
      expect(entry.category).toBeDefined();
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Write Tools via InMemoryTransport
// ---------------------------------------------------------------------------

describe('MCP Server — Write Tools (InMemoryTransport)', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // wiki_write_page
  // -----------------------------------------------------------------------

  it('wiki_write_page creates a valid page', async () => {
    const { parsed } = await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/ml.md',
      title: 'Machine Learning',
      type: 'concept',
      tags: ['ml', 'ai'],
      body: 'Machine learning is a subset of AI.',
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('created');
    expect(result.path).toBe('concepts/ml.md');
    expect(result.title).toBe('Machine Learning');

    // Verify page on disk
    const page = await readPage(join(wikiDir, 'concepts', 'ml.md'));
    expect(page.frontmatter.title).toBe('Machine Learning');
    expect(page.body).toContain('subset of AI');
  });

  it('wiki_write_page updates index automatically', async () => {
    await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/ml.md',
      title: 'Machine Learning',
      type: 'concept',
      tags: ['ml'],
      body: 'ML content.',
    });

    const entries = await readIndex(indexPath);
    const mlEntry = entries.find((e) => e.path === 'concepts/ml.md');
    expect(mlEntry).toBeDefined();
    expect(mlEntry!.title).toBe('Machine Learning');
  });

  // -----------------------------------------------------------------------
  // wiki_update_page
  // -----------------------------------------------------------------------

  it('wiki_update_page merges updates to existing page', async () => {
    const { parsed } = await callTool(client, 'wiki_update_page', {
      pagePath: 'concepts/ai.md',
      tags: ['ai', 'deep-learning'],
      bodyAppend: 'Deep learning is a subfield of AI.',
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('updated');
    expect(result.bodyUpdated).toBe(true);
    expect(result.indexUpdated).toBe(true);

    // Verify on disk
    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.frontmatter.tags).toEqual(['ai', 'deep-learning']);
    expect(page.body).toContain('simulation of human intelligence');
    expect(page.body).toContain('Deep learning is a subfield of AI.');
  });

  it('wiki_update_page bodyReplace replaces body content', async () => {
    await callTool(client, 'wiki_update_page', {
      pagePath: 'concepts/ai.md',
      bodyReplace: 'Completely new content.',
    });

    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toBe('Completely new content.');
    expect(page.body).not.toContain('simulation');
  });

  it('wiki_update_page returns error for nonexistent page', async () => {
    const { isError, text } = await callTool(client, 'wiki_update_page', {
      pagePath: 'nonexistent.md',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Error');
    expect(text).toContain('not found');
  });

  // -----------------------------------------------------------------------
  // wiki_create_entity
  // -----------------------------------------------------------------------

  it('wiki_create_entity creates a typed entity page', async () => {
    const { parsed } = await callTool(client, 'wiki_create_entity', {
      name: 'Ada Lovelace',
      content: 'Ada Lovelace was the first computer programmer.',
      tags: ['mathematics', 'computing'],
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('created');
    expect(result.type).toBe('entity');
    expect(result.title).toBe('Ada Lovelace');
    expect(typeof result.path).toBe('string');
    expect((result.path as string)).toContain('entities/');
    expect((result.path as string)).toContain('.md');

    // Verify the page exists on disk
    const page = await readPage(join(wikiDir, result.path as string));
    expect(page.frontmatter.type).toBe('entity');
    expect(page.frontmatter.title).toBe('Ada Lovelace');
    expect(page.body).toContain('first computer programmer');
  });

  // -----------------------------------------------------------------------
  // wiki_create_concept
  // -----------------------------------------------------------------------

  it('wiki_create_concept creates a typed concept page', async () => {
    const { parsed } = await callTool(client, 'wiki_create_concept', {
      name: 'Neural Networks',
      content: 'Neural networks are computing systems inspired by biological neurons.',
      tags: ['ai', 'deep-learning'],
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('created');
    expect(result.type).toBe('concept');
    expect(result.title).toBe('Neural Networks');
    expect((result.path as string)).toContain('concepts/');

    // Verify on disk
    const page = await readPage(join(wikiDir, result.path as string));
    expect(page.frontmatter.type).toBe('concept');
    expect(page.body).toContain('biological neurons');
  });

  // -----------------------------------------------------------------------
  // wiki_add_crosslinks
  // -----------------------------------------------------------------------

  it('wiki_add_crosslinks adds links between pages', async () => {
    const { parsed } = await callTool(client, 'wiki_add_crosslinks', {
      pagePath: 'concepts/ai.md',
      targetPages: ['entities/turing.md'],
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('updated');
    expect(result.path).toBe('concepts/ai.md');
    expect(result.crosslinks).toEqual(['entities/turing.md']);

    // Verify the crosslink was added to the page
    const page = await readPage(join(wikiDir, 'concepts', 'ai.md'));
    expect(page.body).toContain('See also');
    expect(page.body).toContain('Alan Turing');
  });

  // -----------------------------------------------------------------------
  // wiki_update_index
  // -----------------------------------------------------------------------

  it('wiki_update_index updates metadata in the index', async () => {
    const { parsed } = await callTool(client, 'wiki_update_index', {
      pagePath: 'concepts/ai.md',
      summary: 'Comprehensive overview of artificial intelligence',
      tags: ['ai', 'ml', 'deep-learning'],
    });
    const result = parsed as Record<string, unknown>;

    expect(result.status).toBe('updated');
    expect((result.fieldsUpdated as string[])).toContain('summary');
    expect((result.fieldsUpdated as string[])).toContain('tags');

    // Verify the index was actually updated
    const entries = await readIndex(indexPath);
    const aiEntry = entries.find((e) => e.path === 'concepts/ai.md');
    expect(aiEntry!.summary).toBe('Comprehensive overview of artificial intelligence');
    expect(aiEntry!.tags).toEqual(['ai', 'ml', 'deep-learning']);
  });

  // -----------------------------------------------------------------------
  // wiki_ingest_with_context
  // -----------------------------------------------------------------------

  it('wiki_ingest_with_context returns enhanced result', async () => {
    // Use the absolute path so ingestWithContext can resolve it correctly
    const absSourcePath = join(wikiRoot, 'raw', 'test-source.txt');
    const { parsed } = await callTool(client, 'wiki_ingest_with_context', {
      sourcePath: absSourcePath,
    });
    const result = parsed as Record<string, unknown>;

    expect(result.ingest).toBeDefined();
    expect(typeof result.source_word_count).toBe('number');
    expect(typeof result.source_content_type).toBe('string');
    expect(result.source_content_type).toBe('text');
    expect(Array.isArray(result.related_pages)).toBe(true);
    expect(Array.isArray(result.suggested_actions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Error Cases
// ---------------------------------------------------------------------------

describe('MCP Server — Error Cases', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Path traversal
  // -----------------------------------------------------------------------

  it('wiki_read_page rejects path traversal', async () => {
    const { isError, text } = await callTool(client, 'wiki_read_page', {
      path: '../../../etc/passwd',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal detected');
  });

  it('wiki_write_page rejects path traversal', async () => {
    const { isError, text } = await callTool(client, 'wiki_write_page', {
      pagePath: '../../../etc/shadow',
      title: 'Hack',
      type: 'exploit',
      body: 'malicious',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal detected');
  });

  it('wiki_update_page rejects path traversal', async () => {
    const { isError, text } = await callTool(client, 'wiki_update_page', {
      pagePath: '../../secrets.env',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal detected');
  });

  it('wiki_add_crosslinks rejects path traversal in source', async () => {
    const { isError, text } = await callTool(client, 'wiki_add_crosslinks', {
      pagePath: '../../../etc/passwd',
      targetPages: ['concepts/ai.md'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal');
  });

  it('wiki_add_crosslinks rejects path traversal in targets', async () => {
    const { isError, text } = await callTool(client, 'wiki_add_crosslinks', {
      pagePath: 'concepts/ai.md',
      targetPages: ['../../../etc/passwd'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal');
  });

  // -----------------------------------------------------------------------
  // Missing required arguments
  // -----------------------------------------------------------------------

  it('wiki_query rejects missing query argument', async () => {
    const { isError, text } = await callTool(client, 'wiki_query', {});
    expect(isError).toBe(true);
    expect(text).toContain("'query' must be a non-empty string");
  });

  it('wiki_read_page rejects missing path argument', async () => {
    const { isError, text } = await callTool(client, 'wiki_read_page', {});
    expect(isError).toBe(true);
    expect(text).toContain("'path' must be a non-empty string");
  });

  it('wiki_write_page rejects missing required fields', async () => {
    const { isError, text } = await callTool(client, 'wiki_write_page', {
      pagePath: 'test.md',
      // missing title, type, body
    });
    expect(isError).toBe(true);
    expect(text).toContain('must be a non-empty string');
  });

  it('wiki_create_entity rejects missing name', async () => {
    const { isError, text } = await callTool(client, 'wiki_create_entity', {
      content: 'Some content',
    });
    expect(isError).toBe(true);
    expect(text).toContain("'name' must be a non-empty string");
  });

  it('wiki_create_concept rejects missing name', async () => {
    const { isError, text } = await callTool(client, 'wiki_create_concept', {
      content: 'Some content',
    });
    expect(isError).toBe(true);
    expect(text).toContain("'name' must be a non-empty string");
  });

  it('wiki_add_crosslinks rejects empty targetPages', async () => {
    const { isError, text } = await callTool(client, 'wiki_add_crosslinks', {
      pagePath: 'concepts/ai.md',
      targetPages: [],
    });
    expect(isError).toBe(true);
    expect(text).toContain("'targetPages' must be a non-empty array");
  });

  // -----------------------------------------------------------------------
  // Unknown tool
  // -----------------------------------------------------------------------

  it('unknown tool returns error', async () => {
    const { isError, text } = await callTool(client, 'nonexistent_tool', {});
    expect(isError).toBe(true);
    expect(text).toContain('Unknown tool');
  });

  // -----------------------------------------------------------------------
  // Empty / missing wiki directory
  // -----------------------------------------------------------------------

  it('wiki_status works on empty wiki root', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    const emptyClient = await connectClient(emptyRoot);

    try {
      const { parsed } = await callTool(emptyClient, 'wiki_status');
      const status = parsed as Record<string, unknown>;
      expect(status.command).toBe('status');
      expect(status.source_count).toBe(0);
      expect(status.wiki_page_count).toBe(0);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it('wiki_list_pages returns empty on missing wiki dir', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    const emptyClient = await connectClient(emptyRoot);

    try {
      const { parsed } = await callTool(emptyClient, 'wiki_list_pages');
      expect(parsed).toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it('wiki_list_sources returns empty on missing raw dir', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    const emptyClient = await connectClient(emptyRoot);

    try {
      const { parsed } = await callTool(emptyClient, 'wiki_list_sources');
      expect(parsed).toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it('wiki_read_index returns empty on missing index file', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    const emptyClient = await connectClient(emptyRoot);

    try {
      const { parsed } = await callTool(emptyClient, 'wiki_read_index');
      expect(parsed).toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it('wiki_query returns empty on missing wiki dir', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    const emptyClient = await connectClient(emptyRoot);

    try {
      const { parsed } = await callTool(emptyClient, 'wiki_query', { query: 'anything' });
      const result = parsed as Record<string, unknown>;
      expect(result.matches).toBe(0);
      expect(result.results).toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Invalid argument types
  // -----------------------------------------------------------------------

  it('wiki_write_page rejects non-array tags', async () => {
    const { isError, text } = await callTool(client, 'wiki_write_page', {
      pagePath: 'test.md',
      title: 'Test',
      type: 'concept',
      tags: 'not-an-array',
      body: 'content',
    });
    expect(isError).toBe(true);
    expect(text).toContain("'tags' must be an array of strings");
  });

  it('wiki_ingest_with_context rejects path traversal', async () => {
    const { isError, text } = await callTool(client, 'wiki_ingest_with_context', {
      sourcePath: '../../../etc/passwd',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Error');
  });
});

// ---------------------------------------------------------------------------
// Test Suite: E2E subprocess test
// ---------------------------------------------------------------------------

describe('MCP Server — E2E subprocess', () => {
  let wikiRootE2e: string;

  beforeEach(async () => {
    wikiRootE2e = await mkdtemp(join(tmpdir(), 'mcp-e2e-'));
    const wDir = join(wikiRootE2e, 'wiki');
    await mkdir(wDir, { recursive: true });
    await writeFile(join(wDir, 'log.md'), '');
    await writeIndex(join(wDir, 'index.md'), []);
  });

  afterEach(async () => {
    await rm(wikiRootE2e, { recursive: true, force: true });
  });

  it('should list tools and call wiki_status via stdio subprocess', async () => {
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    );
    const { resolve } = await import('node:path');

    const cliPath = resolve(
      process.cwd(),
      'packages',
      'cli',
      'src',
      'cli.ts',
    );

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', cliPath, 'wiki', 'mcp', '--path', wikiRootE2e],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    const e2eClient = new Client({ name: 'test-e2e', version: '1.0.0' });

    try {
      await e2eClient.connect(transport);

      // Verify tools listing works over real stdio
      const { tools } = await e2eClient.listTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain('wiki_status');
      expect(names).toContain('wiki_query');
      expect(names).toContain('wiki_lint');
      expect(names).toContain('wiki_list_pages');
      expect(names).toContain('wiki_list_sources');
      expect(names).toContain('wiki_read_page');
      expect(names).toContain('wiki_read_index');
      expect(names).toContain('wiki_write_page');

      // Actually call a tool over the subprocess transport
      const statusResult = await e2eClient.callTool({
        name: 'wiki_status',
        arguments: {},
      });
      const content = statusResult.content as Array<{ type: string; text: string }>;
      const status = JSON.parse(content[0].text);

      expect(status.command).toBe('status');
      expect(status.api_version).toBeDefined();
      expect(typeof status.source_count).toBe('number');
    } finally {
      await e2eClient.close();
    }
  }, 30000); // 30s timeout for subprocess startup
});

// ---------------------------------------------------------------------------
// Test Suite: Advanced Integration Scenarios
// ---------------------------------------------------------------------------

describe('MCP Server — Advanced Integration', () => {
  beforeEach(async () => {
    await setupWikiStructure();
    await seedWikiContent();
    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  it('write page then read it back via MCP tools', async () => {
    // Write a new page
    await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/quantum.md',
      title: 'Quantum Computing',
      type: 'concept',
      tags: ['quantum', 'computing'],
      body: 'Quantum computing uses qubits instead of classical bits.',
    });

    // Read it back
    const { parsed } = await callTool(client, 'wiki_read_page', { path: 'concepts/quantum.md' });
    const page = parsed as Record<string, unknown>;
    const fm = page.frontmatter as Record<string, unknown>;

    expect(fm.title).toBe('Quantum Computing');
    expect(fm.type).toBe('concept');
    expect(page.body).toContain('qubits');
  });

  it('create entity then verify it in index', async () => {
    await callTool(client, 'wiki_create_entity', {
      name: 'Claude Shannon',
      content: 'Claude Shannon is the father of information theory.',
      tags: ['information-theory'],
    });

    const { parsed } = await callTool(client, 'wiki_read_index');
    const entries = parsed as Array<Record<string, unknown>>;
    const shannonEntry = entries.find((e) => e.title === 'Claude Shannon');
    expect(shannonEntry).toBeDefined();
    expect((shannonEntry!.path as string)).toContain('entities/');
  });

  it('create concept then query for it', async () => {
    await callTool(client, 'wiki_create_concept', {
      name: 'Reinforcement Learning',
      content: 'Reinforcement learning trains agents via rewards and penalties.',
      tags: ['ai', 'ml'],
    });

    // Query should find the new concept
    const { parsed } = await callTool(client, 'wiki_query', {
      query: 'reinforcement learning',
    });
    const result = parsed as Record<string, unknown>;
    expect(result.matches).toBeGreaterThanOrEqual(1);
  });

  it('full workflow: write, update, crosslink, verify', async () => {
    // Step 1: Create two related pages
    await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/transformers.md',
      title: 'Transformers',
      type: 'concept',
      tags: ['nlp', 'deep-learning'],
      body: 'Transformer architecture revolutionized NLP.',
    });

    await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/attention.md',
      title: 'Attention Mechanism',
      type: 'concept',
      tags: ['nlp', 'deep-learning'],
      body: 'The attention mechanism allows models to focus on relevant parts.',
    });

    // Step 2: Update transformers page
    await callTool(client, 'wiki_update_page', {
      pagePath: 'concepts/transformers.md',
      bodyAppend: 'Self-attention is the core of transformers.',
    });

    // Step 3: Add crosslinks
    await callTool(client, 'wiki_add_crosslinks', {
      pagePath: 'concepts/transformers.md',
      targetPages: ['concepts/attention.md'],
    });

    // Step 4: Verify final state
    const { parsed: pageData } = await callTool(client, 'wiki_read_page', {
      path: 'concepts/transformers.md',
    });
    const page = pageData as Record<string, unknown>;

    expect(page.body).toContain('revolutionized NLP');
    expect(page.body).toContain('Self-attention is the core');
    expect(page.body).toContain('See also');
    expect(page.body).toContain('Attention Mechanism');

    // Verify index has both
    const { parsed: indexData } = await callTool(client, 'wiki_read_index');
    const entries = indexData as Array<Record<string, unknown>>;
    const titles = entries.map((e) => e.title);
    expect(titles).toContain('Transformers');
    expect(titles).toContain('Attention Mechanism');
  });

  it('status reflects changes after writes', async () => {
    // Get initial status
    const { parsed: before } = await callTool(client, 'wiki_status');
    const statusBefore = before as Record<string, unknown>;
    const initialPageCount = statusBefore.wiki_page_count as number;

    // Write a new page
    await callTool(client, 'wiki_write_page', {
      pagePath: 'concepts/new-concept.md',
      title: 'New Concept',
      type: 'concept',
      body: 'Brand new concept.',
    });

    // Get updated status
    const { parsed: after } = await callTool(client, 'wiki_status');
    const statusAfter = after as Record<string, unknown>;

    expect(statusAfter.wiki_page_count).toBe(initialPageCount + 1);
  });
});

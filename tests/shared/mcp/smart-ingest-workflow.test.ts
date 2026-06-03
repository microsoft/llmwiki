/**
 * MCP Server — Smart Ingest Workflow Integration Tests
 *
 * Validates the full 7-step smart ingest workflow end-to-end
 * via InMemoryTransport (client ↔ server).
 *
 * Steps tested:
 *   1. wiki_ingest_with_context  — ingest a source file with context
 *   2. wiki_read_page            — read related pages
 *   3. wiki_create_entity        — create entity page for key person
 *   4. wiki_create_concept       — create concept page for key idea
 *   5. wiki_add_crosslinks       — link summary to entity, concept, existing
 *   6. wiki_update_page          — enrich existing page with new information
 *   7. wiki_lint                 — verify wiki health
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/core/src/mcp/server.js';
import { writePage, readPage } from '../../../packages/core/src/wiki.js';
import { writeIndex, readIndex } from '../../../packages/core/src/index-ops.js';
import type { IndexEntry } from '../../../packages/core/src/index-ops.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let wikiRoot: string;
let client: Client;

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

async function connectClient(root: string): Promise<Client> {
  const server = createMcpServer(root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const c = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await c.connect(clientTransport);

  return c;
}

// ---------------------------------------------------------------------------
// Source content (substantial enough for keyword extraction)
// ---------------------------------------------------------------------------

const TRANSFORMER_SOURCE = `# The Transformer Architecture

The Transformer model, introduced in the 2017 paper "Attention Is All You Need" by Vaswani et al.,
revolutionized natural language processing and artificial intelligence. Unlike recurrent neural networks (RNNs),
Transformers use self-attention mechanisms to process all positions in a sequence simultaneously.

Key components include multi-head attention layers, position-wise feed-forward networks,
and positional encoding since the model has no inherent notion of sequence order.

The architecture has spawned influential models including BERT, GPT, and T5,
forming the foundation of modern large language models. Organizations like OpenAI,
Google DeepMind, and Anthropic have built extensively on this foundational work,
pushing the boundaries of machine learning and deep learning research.
`;

// ---------------------------------------------------------------------------
// Test Suite: Smart Ingest Workflow
// ---------------------------------------------------------------------------

describe('MCP Server — Smart Ingest Workflow', () => {
  beforeEach(async () => {
    wikiRoot = await mkdtemp(join(tmpdir(), 'mcp-smart-ingest-'));
    const wikiDir = join(wikiRoot, 'wiki');
    const rawDir = join(wikiRoot, 'raw');

    await mkdir(wikiDir, { recursive: true });
    await mkdir(rawDir, { recursive: true });
    await mkdir(join(wikiDir, 'concepts'), { recursive: true });
    await mkdir(join(wikiDir, 'entities'), { recursive: true });
    await mkdir(join(wikiDir, 'sources'), { recursive: true });

    // Seed: concepts/ai.md
    await writePage(join(wikiDir, 'concepts', 'ai.md'), {
      frontmatter: {
        type: 'concept',
        title: 'Artificial Intelligence',
        tags: ['ai', 'machine-learning'],
        created: '2026-01-15',
      },
      body: 'Artificial intelligence is the simulation of human intelligence by machines.',
    });

    // Seed: entities/turing.md
    await writePage(join(wikiDir, 'entities', 'turing.md'), {
      frontmatter: {
        type: 'entity',
        title: 'Alan Turing',
        tags: ['computer-science'],
        created: '2026-01-20',
      },
      body: 'Alan Turing was a British mathematician and computer scientist.',
    });

    // Seed: index.md
    const indexPath = join(wikiDir, 'index.md');
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
        tags: ['computer-science'],
      },
    ]);

    // Seed: log.md (empty)
    await writeFile(join(wikiDir, 'log.md'), '');

    // Seed: raw source file for ingest
    await writeFile(
      join(rawDir, 'transformer-architecture.md'),
      TRANSFORMER_SOURCE,
    );

    client = await connectClient(wikiRoot);
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Primary workflow test — all 7 steps
  // -------------------------------------------------------------------------

  it('executes the full 7-step smart ingest workflow', async () => {
    // -----------------------------------------------------------------
    // Step 1: wiki_ingest_with_context
    // -----------------------------------------------------------------
    const { parsed: ingestParsed, isError: ingestError } = await callTool(
      client,
      'wiki_ingest_with_context',
      { sourcePath: join(wikiRoot, 'raw', 'transformer-architecture.md') },
    );
    const ingestResult = ingestParsed as Record<string, unknown>;

    expect(ingestError).toBeFalsy();
    const ingest = ingestResult.ingest as Record<string, unknown>;
    expect(ingest.status).toBe('success');
    const pagesCreated = ingest.pages_created as string[];
    expect(Array.isArray(pagesCreated)).toBe(true);
    expect(pagesCreated.length).toBeGreaterThanOrEqual(1);
    expect(typeof ingestResult.source_word_count).toBe('number');
    expect(ingestResult.source_word_count as number).toBeGreaterThan(0);
    expect(ingestResult.source_content_type).toBe('markdown');
    const suggestedActions = ingestResult.suggested_actions as string[];
    expect(Array.isArray(suggestedActions)).toBe(true);
    expect(suggestedActions.length).toBeGreaterThan(0);
    const relatedPages = ingestResult.related_pages as unknown[];
    expect(Array.isArray(relatedPages)).toBe(true);

    // -----------------------------------------------------------------
    // Step 2: wiki_read_page — read a related existing page
    // -----------------------------------------------------------------
    const { parsed: readParsed, isError: readError } = await callTool(
      client,
      'wiki_read_page',
      { path: 'concepts/ai.md' },
    );
    const readResult = readParsed as Record<string, unknown>;

    expect(readError).toBeFalsy();
    const readFm = readResult.frontmatter as Record<string, unknown>;
    expect(readFm.title).toBe('Artificial Intelligence');
    expect(typeof readResult.body).toBe('string');
    expect((readResult.body as string).length).toBeGreaterThan(0);

    // -----------------------------------------------------------------
    // Step 3: wiki_create_entity
    // -----------------------------------------------------------------
    const { parsed: entityParsed, isError: entityError } = await callTool(
      client,
      'wiki_create_entity',
      {
        name: 'Ashish Vaswani',
        content:
          'Ashish Vaswani is the lead author of the 2017 paper "Attention Is All You Need" that introduced the Transformer architecture, revolutionizing natural language processing.',
        tags: ['researcher', 'transformer', 'google'],
      },
    );
    const entityResult = entityParsed as Record<string, unknown>;

    expect(entityError).toBeFalsy();
    expect(entityResult.status).toBe('created');
    expect((entityResult.path as string)).toContain('entities/');
    expect((entityResult.path as string)).toContain('vaswani');
    expect(entityResult.type).toBe('entity');

    // -----------------------------------------------------------------
    // Step 4: wiki_create_concept
    // -----------------------------------------------------------------
    const { parsed: conceptParsed, isError: conceptError } = await callTool(
      client,
      'wiki_create_concept',
      {
        name: 'Self-Attention',
        content:
          'Self-attention (intra-attention) is a mechanism that relates different positions of a single sequence to compute a representation of that sequence. It is the core mechanism of the Transformer architecture.',
        tags: ['transformer', 'attention', 'deep-learning'],
      },
    );
    const conceptResult = conceptParsed as Record<string, unknown>;

    expect(conceptError).toBeFalsy();
    expect(conceptResult.status).toBe('created');
    expect((conceptResult.path as string)).toContain('concepts/');
    expect((conceptResult.path as string)).toContain('self-attention');
    expect(conceptResult.type).toBe('concept');

    // -----------------------------------------------------------------
    // Step 5: wiki_add_crosslinks
    // -----------------------------------------------------------------
    const summaryPath = pagesCreated[0];
    const entityPath = entityResult.path as string;
    const conceptPath = conceptResult.path as string;

    const { parsed: crosslinkParsed, isError: crosslinkError } =
      await callTool(client, 'wiki_add_crosslinks', {
        pagePath: summaryPath,
        targetPages: [entityPath, conceptPath, 'concepts/ai.md'],
      });
    const crosslinkResult = crosslinkParsed as Record<string, unknown>;

    expect(crosslinkError).toBeFalsy();
    expect(crosslinkResult.status).toBe('updated');
    const crosslinks = crosslinkResult.crosslinks as string[];
    expect(Array.isArray(crosslinks)).toBe(true);
    expect(crosslinks.length).toBe(3);

    // -----------------------------------------------------------------
    // Step 6: wiki_update_page — enrich existing AI page
    // -----------------------------------------------------------------
    const { parsed: updateParsed, isError: updateError } = await callTool(
      client,
      'wiki_update_page',
      {
        pagePath: 'concepts/ai.md',
        bodyAppend:
          '\n\n## Transformer Architecture\n\nThe Transformer model (Vaswani et al., 2017) is a key advancement in AI, replacing recurrence with self-attention mechanisms.',
        tags: ['ai', 'machine-learning', 'transformer'],
      },
    );
    const updateResult = updateParsed as Record<string, unknown>;

    expect(updateError).toBeFalsy();
    expect(updateResult.status).toBe('updated');
    expect(updateResult.bodyUpdated).toBe(true);
    expect(updateResult.indexUpdated).toBe(true);

    // -----------------------------------------------------------------
    // Step 7: wiki_lint — verify wiki health
    // -----------------------------------------------------------------
    const { parsed: lintParsed, isError: lintError } = await callTool(
      client,
      'wiki_lint',
    );

    expect(lintError).toBeFalsy();
    expect(typeof lintParsed).toBe('object');
    expect(lintParsed.errorCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Disk verification tests
  // -------------------------------------------------------------------------

  it('verifies entity page exists on disk after workflow', async () => {
    await callTool(client, 'wiki_create_entity', {
      name: 'Ashish Vaswani',
      content:
        'Ashish Vaswani is the lead author of the 2017 paper "Attention Is All You Need" that introduced the Transformer architecture.',
      tags: ['researcher', 'transformer', 'google'],
    });

    const page = await readPage(
      join(wikiRoot, 'wiki', 'entities', 'ashish-vaswani.md'),
    );
    expect(page.frontmatter.title).toBe('Ashish Vaswani');
    expect(page.frontmatter.type).toBe('entity');
  });

  it('verifies concept page exists on disk after workflow', async () => {
    await callTool(client, 'wiki_create_concept', {
      name: 'Self-Attention',
      content:
        'Self-attention (intra-attention) is a mechanism that relates different positions of a single sequence to compute a representation of that sequence.',
      tags: ['transformer', 'attention', 'deep-learning'],
    });

    const page = await readPage(
      join(wikiRoot, 'wiki', 'concepts', 'self-attention.md'),
    );
    expect(page.frontmatter.title).toBe('Self-Attention');
  });

  it('verifies crosslinks were added to summary page', async () => {
    // Ingest to create the summary page
    const { parsed: ingestParsed } = await callTool(
      client,
      'wiki_ingest_with_context',
      { sourcePath: join(wikiRoot, 'raw', 'transformer-architecture.md') },
    );
    const ingest = (ingestParsed as Record<string, unknown>)
      .ingest as Record<string, unknown>;
    const summaryPath = (ingest.pages_created as string[])[0];

    // Create entity and concept so they exist for crosslinks
    const { parsed: entityParsed } = await callTool(
      client,
      'wiki_create_entity',
      {
        name: 'Ashish Vaswani',
        content: 'Lead author of Attention Is All You Need.',
        tags: ['researcher'],
      },
    );
    const { parsed: conceptParsed } = await callTool(
      client,
      'wiki_create_concept',
      {
        name: 'Self-Attention',
        content: 'Core mechanism of the Transformer architecture.',
        tags: ['transformer'],
      },
    );

    const entityPath = (entityParsed as Record<string, unknown>).path as string;
    const conceptPath = (conceptParsed as Record<string, unknown>)
      .path as string;

    // Add crosslinks
    await callTool(client, 'wiki_add_crosslinks', {
      pagePath: summaryPath,
      targetPages: [entityPath, conceptPath, 'concepts/ai.md'],
    });

    // Read the summary page from disk
    const page = await readPage(join(wikiRoot, 'wiki', summaryPath));
    expect(page.body).toContain('See also');
  });

  it('verifies index was updated with new entries', async () => {
    await callTool(client, 'wiki_create_entity', {
      name: 'Ashish Vaswani',
      content: 'Lead author of Attention Is All You Need.',
      tags: ['researcher'],
    });
    await callTool(client, 'wiki_create_concept', {
      name: 'Self-Attention',
      content: 'Core mechanism of the Transformer architecture.',
      tags: ['transformer'],
    });

    const entries = await readIndex(join(wikiRoot, 'wiki', 'index.md'));
    const titles = entries.map((e: IndexEntry) => e.title);
    expect(titles).toContain('Ashish Vaswani');
    expect(titles).toContain('Self-Attention');
  });

  it('verifies AI page was enriched', async () => {
    await callTool(client, 'wiki_update_page', {
      pagePath: 'concepts/ai.md',
      bodyAppend:
        '\n\n## Transformer Architecture\n\nThe Transformer model (Vaswani et al., 2017) is a key advancement in AI, replacing recurrence with self-attention mechanisms.',
      tags: ['ai', 'machine-learning', 'transformer'],
    });

    const page = await readPage(
      join(wikiRoot, 'wiki', 'concepts', 'ai.md'),
    );
    expect(page.body).toContain('Transformer Architecture');
    expect(page.frontmatter.tags).toContain('transformer');
  });
});

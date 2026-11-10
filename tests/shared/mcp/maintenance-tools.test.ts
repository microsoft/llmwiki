/**
 * MCP maintenance tools: wiki_fix, wiki_delete_page, and relative source
 * paths for wiki_ingest_with_context.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../packages/core/src/mcp/server.js';
import { initWiki } from '../../../packages/core/src/init.js';
import { writePage } from '../../../packages/core/src/wiki.js';
import { readIndex, writeIndex } from '../../../packages/core/src/index-ops.js';

let projectDir: string;
let wikiRoot: string;
let wikiDir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
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
  projectDir = await mkdtemp(join(tmpdir(), 'mcp-maint-'));
  await initWiki(projectDir);
  wikiRoot = join(projectDir, '.wiki');
  wikiDir = join(wikiRoot, 'wiki');

  await writePage(join(wikiDir, 'concepts', 'ai.md'), {
    frontmatter: { type: 'concept', title: 'AI', tags: [], created: '2026-01-01' },
    body: 'See [Turing](../entities/turing.md).',
  });
  await writePage(join(wikiDir, 'entities', 'turing.md'), {
    frontmatter: { type: 'entity', title: 'Alan Turing', tags: [], created: '2026-01-01' },
    body: 'Mathematician.',
  });
  await writePage(join(wikiDir, 'entities', 'gone.md'), {
    frontmatter: { type: 'entity', title: 'Gone', tags: [], created: '2026-01-01', sources: ['sources/removed-summary.md'] },
    body: 'Derived from a removed source.',
  });
  await writeIndex(join(wikiDir, 'index.md'), [
    { path: 'concepts/ai.md', title: 'AI', summary: '', category: 'Concepts', tags: [] },
    { path: 'entities/turing.md', title: 'Alan Turing', summary: '', category: 'Entities', tags: [] },
    { path: 'entities/gone.md', title: 'Gone', summary: '', category: 'Entities', tags: [] },
    { path: 'entities/stale.md', title: 'Stale', summary: '', category: 'Entities', tags: [] },
  ]);

  const server = createMcpServer(wikiRoot);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('wiki_fix', () => {
  it('lint stays accurate after a fixed page is rewritten to its earlier content', async () => {
    // Regression: the long-lived server reused cached, mutated frontmatter.
    const page = { pagePath: 'queries/saved.md', title: 'Saved', type: 'query', body: 'Saved answer.' };
    await call('wiki_write_page', page);
    await call('wiki_fix'); // adds the missing "created" field
    await call('wiki_write_page', page); // the original content again, without "created"

    const { parsed } = await call('wiki_lint');
    const messages = parsed.findings.map((f: { message: string }) => f.message);
    expect(messages).toContain('Missing recommended "created" field in "queries/saved.md"');
  });

  it('previews fixes with dryRun without touching files', async () => {
    const indexBefore = await readFile(join(wikiDir, 'index.md'), 'utf-8');

    const { parsed, isError } = await call('wiki_fix', { dryRun: true });

    expect(isError).toBe(false);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.removed_pages).toEqual(['entities/gone.md']);
    expect(parsed.fixed.map((f: { category: string }) => f.category)).toContain('stale-entries');
    expect(existsSync(join(wikiDir, 'entities', 'gone.md'))).toBe(true);
    expect(await readFile(join(wikiDir, 'index.md'), 'utf-8')).toBe(indexBefore);
  });

  it('applies the fixes', async () => {
    const { parsed } = await call('wiki_fix');

    expect(parsed.dry_run).toBe(false);
    expect(parsed.removed_pages).toEqual(['entities/gone.md']);
    expect(existsSync(join(wikiDir, 'entities', 'gone.md'))).toBe(false);
    const paths = (await readIndex(join(wikiDir, 'index.md'))).map((e) => e.path).sort();
    expect(paths).toEqual(['concepts/ai.md', 'entities/turing.md']);
  });
});

describe('wiki_delete_page', () => {
  it('deletes the page, removes it from the index, logs it and lists backlinks', async () => {
    const { parsed, isError } = await call('wiki_delete_page', { pagePath: 'entities/turing.md' });

    expect(isError).toBe(false);
    expect(parsed.status).toBe('deleted');
    expect(parsed.path).toBe('entities/turing.md');
    expect(parsed.linkedFrom).toEqual([
      { page: 'concepts/ai.md', title: 'AI', linkText: 'Turing' },
    ]);
    expect(existsSync(join(wikiDir, 'entities', 'turing.md'))).toBe(false);
    const paths = (await readIndex(join(wikiDir, 'index.md'))).map((e) => e.path);
    expect(paths).not.toContain('entities/turing.md');
    const log = await readFile(join(wikiDir, 'log.md'), 'utf-8');
    expect(log).toContain('deleted | entities/turing.md');
    expect(log).toContain('Still linked from: concepts/ai.md');
  });

  it('normalizes equivalent paths', async () => {
    const { parsed } = await call('wiki_delete_page', { pagePath: './entities/../entities/turing.md' });
    expect(parsed.path).toBe('entities/turing.md');
  });

  it.each(['index.md', 'log.md', 'concepts/../index.md'])('refuses to delete %s', async (pagePath) => {
    const { text, isError } = await call('wiki_delete_page', { pagePath });
    expect(isError).toBe(true);
    expect(text).toContain('special wiki file');
    expect(existsSync(join(wikiDir, 'index.md'))).toBe(true);
  });

  it('refuses paths outside the wiki directory', async () => {
    const { text, isError } = await call('wiki_delete_page', { pagePath: '../AGENTS.md' });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal');
    expect(existsSync(join(wikiRoot, 'AGENTS.md'))).toBe(true);
  });

  it('refuses non-markdown files', async () => {
    await writeFile(join(wikiDir, 'notes.txt'), 'x');
    const { text, isError } = await call('wiki_delete_page', { pagePath: 'notes.txt' });
    expect(isError).toBe(true);
    expect(text).toContain('markdown page');
  });

  it('reports a missing page', async () => {
    const { text, isError } = await call('wiki_delete_page', { pagePath: 'concepts/nope.md' });
    expect(isError).toBe(true);
    expect(text).toContain('Page not found');
  });
});

describe('wiki_create_entity / wiki_create_concept sources', () => {
  it('records sources so wiki_fix can clean the page up later', async () => {
    await writePage(join(wikiDir, 'sources', 'paper-summary.md'), {
      frontmatter: { type: 'summary', title: 'Paper' },
      body: 'Summary.',
    });

    const { parsed, isError } = await call('wiki_create_concept', {
      name: 'Self-Attention',
      content: 'Attention over a sequence.',
      sources: ['./sources/paper-summary.md'],
    });

    expect(isError).toBe(false);
    expect(parsed.sources).toEqual(['sources/paper-summary.md']);
    const page = await readFile(join(wikiDir, 'concepts', 'self-attention.md'), 'utf-8');
    expect(page).toContain('sources:');
    expect(page).toContain('sources/paper-summary.md');

    await rm(join(wikiDir, 'sources', 'paper-summary.md'));
    const fix = await call('wiki_fix');
    expect(fix.parsed.removed_pages).toContain('concepts/self-attention.md');
  });

  it('rejects sources outside the wiki directory', async () => {
    const { text, isError } = await call('wiki_create_entity', {
      name: 'Mallory',
      content: 'x',
      sources: ['../../etc/passwd'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal');
    expect(existsSync(join(wikiDir, 'entities', 'mallory.md'))).toBe(false);
  });

  it.each([['sources/missing-summary.md'], ['raw/article.md'], ['concepts/ai.md']])(
    'rejects source %s that is not an existing summary page',
    async (source) => {
      const { text, isError } = await call('wiki_create_concept', {
        name: 'Premature',
        content: 'x',
        sources: [source],
      });
      expect(isError).toBe(true);
      expect(text).toContain('Source page not found');
      expect(existsSync(join(wikiDir, 'concepts', 'premature.md'))).toBe(false);
    },
  );

  describe('wiki_update_page addSources', () => {
    beforeEach(async () => {
      for (const name of ['a', 'b']) {
        await writePage(join(wikiDir, 'sources', `${name}-summary.md`), {
          frontmatter: { type: 'summary', title: name.toUpperCase() },
          body: 'Summary.',
        });
      }
      await call('wiki_create_concept', { name: 'Shared', content: 'From A.', sources: ['sources/a-summary.md'] });
    });

    it('appends sources so the page survives removing one of them', async () => {
      const { parsed, isError } = await call('wiki_update_page', {
        pagePath: 'concepts/shared.md',
        bodyAppend: 'From B.',
        addSources: ['sources/b-summary.md', 'sources/a-summary.md'],
      });

      expect(isError).toBe(false);
      expect(parsed.sourcesUpdated).toBe(true);
      expect(parsed.frontmatter.sources).toEqual(['sources/a-summary.md', 'sources/b-summary.md']);

      await rm(join(wikiDir, 'sources', 'a-summary.md'));
      expect((await call('wiki_fix', { dryRun: true })).parsed.removed_pages).not.toContain('concepts/shared.md');

      await rm(join(wikiDir, 'sources', 'b-summary.md'));
      expect((await call('wiki_fix', { dryRun: true })).parsed.removed_pages).toContain('concepts/shared.md');
    });

    it('never adds sources to a page that lists none', async () => {
      const { parsed } = await call('wiki_update_page', {
        pagePath: 'entities/turing.md',
        bodyAppend: 'Extra.',
        addSources: ['sources/b-summary.md'],
      });

      expect(parsed.sourcesUpdated).toBe(false);
      expect(parsed.frontmatter.sources).toBeUndefined();
    });

    it('rejects sources that do not exist', async () => {
      const { text, isError } = await call('wiki_update_page', {
        pagePath: 'concepts/shared.md',
        addSources: ['sources/nope-summary.md'],
      });
      expect(isError).toBe(true);
      expect(text).toContain('Source page not found');
    });
  });
});

describe('wiki_ingest_with_context', () => {
  it('resolves a relative sourcePath against the wiki root', async () => {
    await writeFile(join(wikiRoot, 'raw', 'note.md'), '# Note\n\nTuring machines and artificial intelligence.');

    const { parsed, isError } = await call('wiki_ingest_with_context', { sourcePath: 'raw/note.md' });

    expect(isError).toBe(false);
    expect(parsed.ingest.status).not.toBe('error');
    expect(existsSync(join(wikiDir, 'sources', 'note-summary.md'))).toBe(true);

    const again = await call('wiki_ingest_with_context', { sourcePath: 'raw/note.md' });
    expect(again.parsed.ingest.status).toBe('skipped');
    expect(again.parsed.ingest.summary_page).toBe('sources/note-summary.md');
  });

  it('still rejects sources outside the wiki root', async () => {
    await writeFile(join(projectDir, 'outside.md'), 'secret');
    const { text, isError } = await call('wiki_ingest_with_context', { sourcePath: '../outside.md' });
    expect(isError).toBe(true);
    expect(text).toContain('Path traversal');
  });
});

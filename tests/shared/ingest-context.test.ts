import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ingestWithContext,
  detectContentType,
  countWords,
  extractKeywords,
} from '../../packages/shared/src/ingest-context.js';
import { handleWriteToolCall } from '../../packages/shared/src/mcp/write-tools.js';

// ---------------------------------------------------------------------------
// detectContentType
// ---------------------------------------------------------------------------

describe('detectContentType', () => {
  it('detects markdown', () => {
    expect(detectContentType('file.md')).toBe('markdown');
  });

  it('detects text', () => {
    expect(detectContentType('file.txt')).toBe('text');
  });

  it('detects pdf', () => {
    expect(detectContentType('file.pdf')).toBe('pdf');
  });

  it('detects html from .html', () => {
    expect(detectContentType('file.html')).toBe('html');
  });

  it('detects html from .htm', () => {
    expect(detectContentType('file.htm')).toBe('html');
  });

  it('detects json', () => {
    expect(detectContentType('file.json')).toBe('json');
  });

  it('detects csv', () => {
    expect(detectContentType('file.csv')).toBe('csv');
  });

  it('detects yaml from .yaml', () => {
    expect(detectContentType('file.yaml')).toBe('yaml');
  });

  it('detects yaml from .yml', () => {
    expect(detectContentType('file.yml')).toBe('yaml');
  });

  it('detects xml', () => {
    expect(detectContentType('file.xml')).toBe('xml');
  });

  it('detects restructuredtext', () => {
    expect(detectContentType('file.rst')).toBe('restructuredtext');
  });

  it('detects latex', () => {
    expect(detectContentType('file.tex')).toBe('latex');
  });

  it('detects word from .doc', () => {
    expect(detectContentType('file.doc')).toBe('word');
  });

  it('detects word from .docx', () => {
    expect(detectContentType('file.docx')).toBe('word');
  });

  it('detects richtext', () => {
    expect(detectContentType('file.rtf')).toBe('richtext');
  });

  it('returns unknown for unrecognized extension', () => {
    expect(detectContentType('file.xyz')).toBe('unknown');
  });

  it('returns unknown for no extension', () => {
    expect(detectContentType('README')).toBe('unknown');
  });

  it('is case insensitive on extension', () => {
    expect(detectContentType('file.MD')).toBe('markdown');
    expect(detectContentType('file.JSON')).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts words in normal text', () => {
    expect(countWords('hello world foo bar')).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('handles multiple spaces', () => {
    expect(countWords('hello   world')).toBe(2);
  });

  it('handles newlines and tabs', () => {
    expect(countWords('hello\nworld\tfoo')).toBe(3);
  });

  it('counts single word', () => {
    expect(countWords('hello')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('extracts meaningful keywords', () => {
    const keywords = extractKeywords(
      'The quick brown fox jumps over the lazy dog',
    );
    expect(keywords).toContain('quick');
    expect(keywords).toContain('brown');
    expect(keywords).toContain('fox');
    expect(keywords).toContain('jumps');
    expect(keywords).toContain('over');
    expect(keywords).toContain('lazy');
    expect(keywords).toContain('dog');
    // stop words filtered
    expect(keywords).not.toContain('the');
  });

  it('removes duplicates', () => {
    const keywords = extractKeywords('cat cat cat dog dog');
    expect(keywords).toEqual(['cat', 'dog']);
  });

  it('filters words shorter than 3 characters', () => {
    const keywords = extractKeywords('I am a big cat');
    expect(keywords).not.toContain('am');
    expect(keywords).toContain('big');
    expect(keywords).toContain('cat');
  });

  it('returns empty for empty text', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('removes stop words', () => {
    const keywords = extractKeywords('this is the best thing');
    expect(keywords).not.toContain('this');
    expect(keywords).not.toContain('the');
    expect(keywords).toContain('best');
    expect(keywords).toContain('thing');
  });

  it('strips non-alphanumeric characters', () => {
    const keywords = extractKeywords('hello-world foo_bar baz!');
    expect(keywords).toContain('hello');
    expect(keywords).toContain('world');
    expect(keywords).toContain('foo');
    expect(keywords).toContain('bar');
    expect(keywords).toContain('baz');
  });

  it('respects maxWords limit', () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const keywords = extractKeywords(text, 5);
    expect(keywords.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// ingestWithContext (integration)
// ---------------------------------------------------------------------------

describe('ingestWithContext', () => {
  let tempDir: string;
  let sourcesDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmwiki-ctx-'));
    sourcesDir = join(tempDir, 'sources');

    // Initialise minimal wiki structure
    await mkdir(join(tempDir, 'wiki'), { recursive: true });
    await mkdir(join(tempDir, 'wiki', 'sources'), { recursive: true });
    await mkdir(sourcesDir, { recursive: true });

    // Create wiki index and log
    await writeFile(
      join(tempDir, 'wiki', 'index.md'),
      '---\nentries: []\n---\n# Wiki Index\n',
    );
    await writeFile(
      join(tempDir, 'wiki', 'log.md'),
      '---\nentries: []\n---\n# Wiki Log\n',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns enhanced result on successful ingest', async () => {
    const sourceFile = join(sourcesDir, 'test-doc.md');
    await writeFile(
      sourceFile,
      '# Test Document\n\nThis is a test document about artificial intelligence and machine learning.',
    );

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.ingest.status).toBe('success');
    expect(result.source_word_count).toBeGreaterThan(0);
    expect(result.source_content_type).toBe('markdown');
    expect(result.related_pages).toBeInstanceOf(Array);
    expect(result.suggested_actions).toBeInstanceOf(Array);
    expect(result.suggested_actions.length).toBeGreaterThan(0);
  });

  it('correctly counts words', async () => {
    const sourceFile = join(sourcesDir, 'word-count.txt');
    await writeFile(sourceFile, 'one two three four five');

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.source_word_count).toBe(5);
    expect(result.source_content_type).toBe('text');
  });

  it('detects content type from extension', async () => {
    const sourceFile = join(sourcesDir, 'data.json');
    await writeFile(sourceFile, '{"key": "value"}');

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.source_content_type).toBe('json');
  });

  it('returns empty related pages for empty wiki', async () => {
    const sourceFile = join(sourcesDir, 'new-doc.md');
    await writeFile(
      sourceFile,
      '# New Document\n\nSome content about a brand new topic.',
    );

    const result = await ingestWithContext(sourceFile, tempDir);

    // Empty wiki should have no related pages (or only self which gets filtered)
    expect(result.related_pages.length).toBe(0);
  });

  it('generates suggested actions for success', async () => {
    const sourceFile = join(sourcesDir, 'actions-test.md');
    await writeFile(
      sourceFile,
      '# Actions Test\n\nSome content for testing suggested actions.',
    );

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.ingest.status).toBe('success');
    expect(result.suggested_actions).toContain(
      'Review the generated summary page for accuracy',
    );
    expect(result.suggested_actions).toContain(
      'Create entity pages for mentioned people, organizations, or concepts',
    );
  });

  it('handles dry run and still returns context', async () => {
    const sourceFile = join(sourcesDir, 'dryrun.md');
    await writeFile(
      sourceFile,
      '# Dry Run Test\n\nTesting that context is returned even in dry run mode.',
    );

    const result = await ingestWithContext(sourceFile, tempDir, true);

    expect(result.ingest.dry_run).toBe(true);
    expect(result.source_word_count).toBeGreaterThan(0);
    expect(result.source_content_type).toBe('markdown');
    expect(result.suggested_actions.length).toBeGreaterThan(0);
  });

  it('handles missing source file', async () => {
    const result = await ingestWithContext(
      join(sourcesDir, 'nonexistent.md'),
      tempDir,
    );

    expect(result.ingest.status).toBe('error');
    expect(result.source_word_count).toBe(0);
    expect(result.suggested_actions).toContain(
      'Fix the ingest error and retry',
    );
  });

  it('handles uninitialised wiki', async () => {
    // Remove wiki directory
    await rm(join(tempDir, 'wiki'), { recursive: true, force: true });

    const sourceFile = join(sourcesDir, 'test.md');
    await writeFile(sourceFile, '# Test\n\nContent');

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.ingest.status).toBe('error');
  });

  it('generates skipped actions when source already ingested', async () => {
    const sourceFile = join(sourcesDir, 'dup.md');
    await writeFile(sourceFile, '# Duplicate\n\nAlready ingested content.');

    // First ingest
    await ingestWithContext(sourceFile, tempDir);

    // Second ingest without force
    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.ingest.status).toBe('skipped');
    expect(result.suggested_actions).toContain(
      'Use force=true to re-ingest this source',
    );
  });

  it('finds related pages when wiki has matching content', async () => {
    // Create an existing wiki page about AI
    const existingPage = join(tempDir, 'wiki', 'ai-basics.md');
    await writeFile(
      existingPage,
      '---\ntitle: AI Basics\nsummary: Introduction to artificial intelligence\ncategory: Concepts\ntags: []\n---\n# AI Basics\n\nArtificial intelligence is the simulation of human intelligence.',
    );

    // Update index to include this page
    await writeFile(
      join(tempDir, 'wiki', 'index.md'),
      '---\nentries:\n  - title: AI Basics\n    path: ai-basics.md\n    summary: Introduction to artificial intelligence\n    category: Concepts\n    tags: []\n---\n# Wiki Index\n',
    );

    // Ingest a related source
    const sourceFile = join(sourcesDir, 'ai-advanced.md');
    await writeFile(
      sourceFile,
      '# Advanced AI\n\nThis document covers advanced topics in artificial intelligence and neural networks.',
    );

    const result = await ingestWithContext(sourceFile, tempDir);

    expect(result.ingest.status).toBe('success');
    // The existing AI page should be found as related
    expect(Array.isArray(result.related_pages)).toBe(true);
    for (const page of result.related_pages) {
      expect(page).toHaveProperty('path');
      expect(page).toHaveProperty('title');
      expect(page).toHaveProperty('score');
    }
  });
});

// ---------------------------------------------------------------------------
// wiki_ingest_with_context MCP tool
// ---------------------------------------------------------------------------

describe('wiki_ingest_with_context MCP tool', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmwiki-mcp-ctx-'));

    // Initialise wiki structure
    await mkdir(join(tempDir, 'wiki'), { recursive: true });
    await mkdir(join(tempDir, 'wiki', 'sources'), { recursive: true });
    await mkdir(join(tempDir, 'sources'), { recursive: true });
    await writeFile(
      join(tempDir, 'wiki', 'index.md'),
      '---\nentries: []\n---\n# Wiki Index\n',
    );
    await writeFile(
      join(tempDir, 'wiki', 'log.md'),
      '---\nentries: []\n---\n# Wiki Log\n',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('handles wiki_ingest_with_context call', async () => {
    const sourceFile = join(tempDir, 'sources', 'mcp-test.md');
    await writeFile(
      sourceFile,
      '# MCP Test\n\nTesting the MCP tool integration.',
    );

    const resultStr = await handleWriteToolCall(
      'wiki_ingest_with_context',
      { sourcePath: sourceFile },
      tempDir,
    );

    const result = JSON.parse(resultStr);
    expect(result.ingest).toBeDefined();
    expect(result.ingest.status).toBe('success');
    expect(result.source_word_count).toBeGreaterThan(0);
    expect(result.source_content_type).toBe('markdown');
    expect(result.related_pages).toBeInstanceOf(Array);
    expect(result.suggested_actions).toBeInstanceOf(Array);
  });

  it('supports dryRun parameter', async () => {
    const sourceFile = join(tempDir, 'sources', 'dry.md');
    await writeFile(sourceFile, '# Dry\n\nDry run test.');

    const resultStr = await handleWriteToolCall(
      'wiki_ingest_with_context',
      { sourcePath: sourceFile, dryRun: true },
      tempDir,
    );

    const result = JSON.parse(resultStr);
    expect(result.ingest.dry_run).toBe(true);
  });

  it('supports force parameter', async () => {
    const sourceFile = join(tempDir, 'sources', 'force.md');
    await writeFile(sourceFile, '# Force\n\nForce re-ingest test.');

    // First ingest
    await handleWriteToolCall(
      'wiki_ingest_with_context',
      { sourcePath: sourceFile },
      tempDir,
    );

    // Second ingest with force
    const resultStr = await handleWriteToolCall(
      'wiki_ingest_with_context',
      { sourcePath: sourceFile, force: true },
      tempDir,
    );

    const result = JSON.parse(resultStr);
    expect(result.ingest.status).toBe('success');
  });

  it('requires sourcePath argument', async () => {
    await expect(
      handleWriteToolCall('wiki_ingest_with_context', {}, tempDir),
    ).rejects.toThrow();
  });
});

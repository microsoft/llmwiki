import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { addCrosslinks, readPage, writePage } from '../../packages/core/src/wiki.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('addCrosslinks', () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(join(tmpdir(), 'crosslinks-test-'));
    await mkdir(join(wikiDir, 'concepts'), { recursive: true });
    await mkdir(join(wikiDir, 'entities'), { recursive: true });
  });

  afterEach(async () => {
    await rm(wikiDir, { recursive: true, force: true });
  });

  it('should return early when toPages is empty', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Artificial Intelligence content.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', []);

    const page = await readPage(fromPath);
    expect(page.body).not.toContain('## See also');
  });

  it('should throw when source page does not exist', async () => {
    await expect(
      addCrosslinks(wikiDir, 'concepts/nonexistent.md', ['entities/openai.md']),
    ).rejects.toThrow('Source page not found: concepts/nonexistent.md');
  });

  it('should throw listing all missing target pages', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Content.',
    });

    await expect(
      addCrosslinks(wikiDir, 'concepts/ai.md', [
        'entities/missing1.md',
        'entities/missing2.md',
      ]),
    ).rejects.toThrow('Target pages not found: entities/missing1.md, entities/missing2.md');
  });

  it('should add See also section with correct relative links', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    const toPath = join(wikiDir, 'entities', 'openai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Artificial Intelligence content.',
    });
    await writePage(toPath, {
      frontmatter: { title: 'OpenAI' },
      body: 'OpenAI is a company.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['entities/openai.md']);

    const page = await readPage(fromPath);
    expect(page.body).toContain('## See also');
    expect(page.body).toContain('- [OpenAI](../entities/openai.md)');
  });

  it('should use filename as fallback title when frontmatter title is missing', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    const toPath = join(wikiDir, 'entities', 'openai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Content.',
    });
    await writePage(toPath, {
      frontmatter: {},
      body: 'No title here.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['entities/openai.md']);

    const page = await readPage(fromPath);
    expect(page.body).toContain('- [openai](../entities/openai.md)');
  });

  it('should append to existing See also section', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    const toPath1 = join(wikiDir, 'entities', 'openai.md');
    const toPath2 = join(wikiDir, 'entities', 'google.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Content.\n\n## See also\n\n- [OpenAI](../entities/openai.md)',
    });
    await writePage(toPath1, {
      frontmatter: { title: 'OpenAI' },
      body: 'OpenAI.',
    });
    await writePage(toPath2, {
      frontmatter: { title: 'Google' },
      body: 'Google.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['entities/google.md']);

    const page = await readPage(fromPath);
    expect(page.body).toContain('- [OpenAI](../entities/openai.md)');
    expect(page.body).toContain('- [Google](../entities/google.md)');
  });

  it('should avoid duplicate links in existing See also section', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    const toPath = join(wikiDir, 'entities', 'openai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Content.\n\n## See also\n\n- [OpenAI](../entities/openai.md)',
    });
    await writePage(toPath, {
      frontmatter: { title: 'OpenAI' },
      body: 'OpenAI.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['entities/openai.md']);

    const page = await readPage(fromPath);
    const matches = page.body.match(/\- \[OpenAI\]\(\.\.\/entities\/openai\.md\)/g);
    expect(matches).toHaveLength(1);
  });

  it('should handle multiple toPages at once', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'AI content.',
    });
    await writePage(join(wikiDir, 'entities', 'openai.md'), {
      frontmatter: { title: 'OpenAI' },
      body: 'OpenAI.',
    });
    await writePage(join(wikiDir, 'entities', 'google.md'), {
      frontmatter: { title: 'Google' },
      body: 'Google.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', [
      'entities/openai.md',
      'entities/google.md',
    ]);

    const page = await readPage(fromPath);
    expect(page.body).toContain('## See also');
    expect(page.body).toContain('- [OpenAI](../entities/openai.md)');
    expect(page.body).toContain('- [Google](../entities/google.md)');
  });

  it('should handle same-directory crosslinks', async () => {
    const fromPath = join(wikiDir, 'concepts', 'ai.md');
    const toPath = join(wikiDir, 'concepts', 'ml.md');
    await writePage(fromPath, {
      frontmatter: { title: 'AI' },
      body: 'Content.',
    });
    await writePage(toPath, {
      frontmatter: { title: 'Machine Learning' },
      body: 'ML content.',
    });

    await addCrosslinks(wikiDir, 'concepts/ai.md', ['concepts/ml.md']);

    const page = await readPage(fromPath);
    expect(page.body).toContain('- [Machine Learning](ml.md)');
  });
});

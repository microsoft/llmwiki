/**
 * Integration test runner for the LLM Wiki VS Code extension.
 * Uses @vscode/test-electron to launch a real VS Code instance on a fixture
 * workspace that contains a wiki with known problems.
 *
 * Run locally: npm run build && npm run test:integration
 * Not run in CI (needs a display server).
 */
import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { initWiki, writePage, writeIndex } from '../../../packages/core/dist/index.js';

/**
 * Create a workspace whose wiki needs fixing:
 *  - entities/gone.md was derived from a source summary that no longer exists
 *  - the index lists a page that was deleted (stale entry)
 *  - concepts/unindexed.md is missing from the index
 *  - concepts/linked.md links to a page that does not exist
 */
async function createFixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'llmwiki-integration-'));
  await initWiki(workspace);
  const wikiDir = path.join(workspace, '.wiki', 'wiki');

  await writePage(path.join(wikiDir, 'entities', 'gone.md'), {
    frontmatter: { type: 'entity', title: 'Gone', tags: [], created: '2026-01-01', sources: ['sources/removed-summary.md'] },
    body: 'Derived from a source that was removed.',
  });
  await writePage(path.join(wikiDir, 'concepts', 'linked.md'), {
    frontmatter: { type: 'concept', title: 'Linked', tags: [], created: '2026-01-01' },
    body: 'See [a missing page](missing.md).',
  });
  await writePage(path.join(wikiDir, 'concepts', 'unindexed.md'), {
    frontmatter: { type: 'concept', title: 'Unindexed', tags: [], created: '2026-01-01' },
    body: 'Not in the index yet.',
  });
  await writeIndex(path.join(wikiDir, 'index.md'), [
    { path: 'entities/gone.md', title: 'Gone', summary: '', category: 'Entities', tags: [] },
    { path: 'concepts/linked.md', title: 'Linked', summary: '', category: 'Concepts', tags: [] },
    { path: 'concepts/deleted.md', title: 'Deleted', summary: '', category: 'Concepts', tags: [] },
  ]);

  await mkdir(path.join(workspace, '.wiki', 'raw'), { recursive: true });
  await writeFile(path.join(workspace, '.wiki', 'raw', 'note.md'), '# Note\n\nA raw source.');
  return workspace;
}

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../../packages/vscode');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const workspace = await createFixtureWorkspace();

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: { LLMWIKI_TEST_WORKSPACE: workspace },
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();

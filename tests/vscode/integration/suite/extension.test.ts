/**
 * Integration tests that run inside a real VS Code instance on the fixture
 * workspace created by runTest.ts.
 */
import * as assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXTENSION_ID = 'eag-rss.llmwiki';

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(folder, 'Expected the fixture workspace to be open');
  return folder;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function frontmatterName(file: string): string | undefined {
  const match = readFileSync(file, 'utf-8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1].match(/^name:\s*(.+)$/m)?.[1].trim();
}

suite('LLM Wiki extension', () => {
  let extension: vscode.Extension<unknown>;

  suiteSetup(async () => {
    const found = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(found, `Extension ${EXTENSION_ID} not found`);
    extension = found;
    await extension.activate();
    // Views and commands are registered once the wiki is detected.
    await waitFor(async () => (await vscode.commands.getCommands(true)).includes('llmwiki.lint'));
  });

  test('activates in a workspace with a wiki', () => {
    assert.ok(extension.isActive);
  });

  test('no longer contributes a chat participant', () => {
    assert.strictEqual(extension.packageJSON.contributes.chatParticipants, undefined);
  });

  test('ships every contributed skill, agent and instructions file', () => {
    const contributes = extension.packageJSON.contributes;
    const entries: Array<{ path: string }> = [
      ...contributes.chatSkills,
      ...contributes.chatAgents,
      ...contributes.chatInstructions,
    ];
    assert.strictEqual(contributes.chatSkills.length, 5);
    for (const entry of entries) {
      const file = join(extension.extensionPath, entry.path);
      assert.ok(existsSync(file), `Missing ${entry.path}`);
    }
    for (const skill of contributes.chatSkills as Array<{ path: string }>) {
      const file = join(extension.extensionPath, skill.path);
      const folder = skill.path.split('/').slice(-2, -1)[0];
      assert.strictEqual(frontmatterName(file), folder, `${skill.path} name must match its folder`);
    }
  });

  test('registers the wiki maintenance commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['llmwiki.fix', 'llmwiki.lint', 'llmwiki.fixWithCopilot', 'llmwiki.refresh']) {
      assert.ok(commands.includes(id), `Command ${id} is not registered`);
    }
  });

  test('Run Lint completes without changing the wiki', async () => {
    const indexPath = join(workspaceRoot(), '.wiki', 'wiki', 'index.md');
    const before = readFileSync(indexPath, 'utf-8');
    await vscode.commands.executeCommand('llmwiki.lint');
    assert.strictEqual(readFileSync(indexPath, 'utf-8'), before);
  });

  test('Fix Issues applies the deterministic fixes on disk', async () => {
    const wikiDir = join(workspaceRoot(), '.wiki', 'wiki');

    await vscode.commands.executeCommand('llmwiki.fix');

    assert.ok(!existsSync(join(wikiDir, 'entities', 'gone.md')), 'orphaned derived page should be removed');
    const index = readFileSync(join(wikiDir, 'index.md'), 'utf-8');
    assert.ok(!index.includes('concepts/deleted.md'), 'stale index entry should be removed');
    assert.ok(index.includes('concepts/unindexed.md'), 'unindexed page should be added');
    assert.ok(index.includes('concepts/linked.md'));
    const log = readFileSync(join(wikiDir, 'log.md'), 'utf-8');
    assert.ok(log.includes('lint-fix | wiki'), 'fix should be logged');
    // The broken link needs judgment and is left for /wiki-fix.
    assert.ok(readFileSync(join(wikiDir, 'concepts', 'linked.md'), 'utf-8').includes('missing.md'));
  });

  test('the MCP server starts with the editor runtime the provider uses', async function () {
    this.timeout(60_000);
    const launcher = join(extension.extensionPath, 'out', 'mcp-server.cjs');
    const wikiRoot = join(workspaceRoot(), '.wiki');
    assert.ok(existsSync(launcher), 'out/mcp-server.cjs is missing — run npm run build');

    // Mirror createLlmWikiServerDefinition: process.execPath + launcher + wiki
    // root, with ELECTRON_RUN_AS_NODE supplied by the definition rather than
    // inherited from the extension host.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
    }
    env.ELECTRON_RUN_AS_NODE = '1';

    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [launcher, wikiRoot], env, cwd: workspaceRoot() }),
    );
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      assert.ok(names.includes('wiki_fix') && names.includes('wiki_delete_page'));
      assert.ok(!names.includes('wiki_open'), 'a bound server should not offer wiki_open');
      assert.strictEqual(tools.find((t) => t.name === 'wiki_query')?.annotations?.readOnlyHint, true);
      assert.ok(client.getInstructions()?.includes("This wiki's schema (.wiki/AGENTS.md)"));

      const status = await client.callTool({ name: 'wiki_status', arguments: {} });
      assert.ok(!status.isError);
      assert.strictEqual((status.structuredContent as { source_count: number }).source_count, 1);
    } finally {
      await client.close();
    }
  });
});

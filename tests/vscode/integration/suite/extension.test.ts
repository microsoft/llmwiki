/**
 * Smoke test: verifies the LLM Wiki extension activates in a real VS Code instance.
 * Run via: npx ts-node tests/vscode/integration/runTest.ts
 */
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('llmwiki.llmwiki-vscode');
    assert.ok(ext, 'Extension not found — check publisher.name in package.json');
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('llmwiki.llmwiki-vscode');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext?.isActive, 'Extension did not activate');
  });
});

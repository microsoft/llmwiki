/**
 * Integration test runner for the LLM Wiki VS Code extension.
 * Uses @vscode/test-electron to launch a real VS Code instance.
 *
 * Run locally: npx ts-node tests/vscode/integration/runTest.ts
 * Not run in CI (needs a display server).
 */
import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../packages/vscode');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();

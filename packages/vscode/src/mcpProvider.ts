import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { WIKI_DIR_NAME } from '@llmwiki/core';

/**
 * Build the stdio definition VS Code uses to start the `llmwiki` MCP server.
 *
 * The command is the editor's own executable (`process.execPath`), so the
 * server doesn't depend on a system Node install. That binary only behaves
 * like Node when `ELECTRON_RUN_AS_NODE` is set, and the process that spawns
 * MCP servers (for example the Agent Host behind the Copilot harness) may not
 * inherit it from the extension host, so it is set explicitly.
 */
export function createLlmWikiServerDefinition(
  launcherPath: string,
  wikiRoot: string,
  workspaceFolder: string,
  version: string,
): vscode.McpStdioServerDefinition {
  const definition = new vscode.McpStdioServerDefinition(
    'LLM Wiki',
    process.execPath,
    [launcherPath, wikiRoot],
    { ELECTRON_RUN_AS_NODE: '1' },
    version,
  );
  definition.cwd = vscode.Uri.file(workspaceFolder);
  return definition;
}

/**
 * Registers an `McpServerDefinitionProvider` that exposes the `llmwiki` MCP
 * server to Copilot Chat (and any other MCP-aware consumer in VS Code).
 *
 * The provider points at the `llmwiki-mcp` launcher shipped by the
 * `@llmwiki/core` package — we resolve it through `createRequire` so that
 * the path stays correct whether the extension is installed from the VS
 * Marketplace or run from a development checkout.
 *
 * No-op (with a log line) if the wiki has not been initialised yet — the
 * launcher refuses to start without a wiki root, so there is nothing useful
 * to publish in that state.
 */
export function registerMcpServerProvider(
  context: vscode.ExtensionContext,
  workspaceFolder: string,
  outputChannel: vscode.OutputChannel,
): vscode.Disposable | undefined {
  // The `vscode.lm.registerMcpServerDefinitionProvider` API ships in VS Code
  // 1.101+.  Guard the call so older hosts (which our `engines.vscode`
  // requirement is bumped to match) still load the extension gracefully if a
  // user happens to be on a slightly older insider build.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') {
    outputChannel.appendLine(
      '[mcp] vscode.lm.registerMcpServerDefinitionProvider unavailable — skipping auto-registration.',
    );
    return undefined;
  }

  const wikiRoot = join(workspaceFolder, WIKI_DIR_NAME);

  // Locate the MCP launcher. The build step bundles a self-contained copy at
  // `out/mcp-server.cjs` (so it works in the packaged VSIX, which ships no
  // node_modules). Fall back to resolving the `@llmwiki/core` launcher when
  // running from a dev checkout where the bundle may be absent.
  let launcherPath: string | undefined;
  const bundled = context.asAbsolutePath(join('out', 'mcp-server.cjs'));
  if (existsSync(bundled)) {
    launcherPath = bundled;
  } else {
    try {
      // `require` is provided by esbuild's CJS output; we don't import it from
      // 'node:module' because that would require ESM in the host bundle.
      launcherPath = require.resolve('@llmwiki/core/mcp-bin');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[mcp] Could not locate llmwiki-mcp launcher: ${msg}`);
      return undefined;
    }
  }

  const emitter = new vscode.EventEmitter<void>();

  const provider: vscode.McpServerDefinitionProvider = {
    onDidChangeMcpServerDefinitions: emitter.event,
    provideMcpServerDefinitions: () => [
      createLlmWikiServerDefinition(
        launcherPath,
        wikiRoot,
        workspaceFolder,
        context.extension.packageJSON.version as string,
      ),
    ],
  };

  outputChannel.appendLine(
    `[mcp] Registered llmwiki MCP server provider → ${launcherPath} ${wikiRoot}`,
  );

  const disposable = vscode.lm.registerMcpServerDefinitionProvider('llmwiki', provider);
  context.subscriptions.push(disposable, emitter);
  return disposable;
}

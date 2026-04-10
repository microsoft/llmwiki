import * as vscode from 'vscode';
import { WikiPagesTreeDataProvider } from './wikiPagesTree';
import { registerCommands } from './commands';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('LLM Wiki');
  outputChannel.appendLine('LLM Wiki extension activated');

  vscode.commands.executeCommand('setContext', 'llmwiki.isWikiWorkspace', true);

  context.subscriptions.push(outputChannel);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    outputChannel.appendLine('No workspace folder found — skipping tree view registration');
    return;
  }

  const wikiPagesProvider = new WikiPagesTreeDataProvider(workspaceFolder);
  const treeRegistration = vscode.window.registerTreeDataProvider('wikiPages', wikiPagesProvider);

  const watcher = vscode.workspace.createFileSystemWatcher('**/wiki/**/*.md');
  watcher.onDidChange(() => wikiPagesProvider.refresh());
  watcher.onDidCreate(() => wikiPagesProvider.refresh());
  watcher.onDidDelete(() => wikiPagesProvider.refresh());

  registerCommands(context, workspaceFolder, { wikiPages: wikiPagesProvider }, outputChannel);

  context.subscriptions.push(treeRegistration, watcher, wikiPagesProvider);
}

export function deactivate(): void {
  // Resources disposed via context.subscriptions
}

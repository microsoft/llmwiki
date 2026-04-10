import * as vscode from 'vscode';
import { WikiPagesTreeDataProvider } from './wikiPagesTree';
import { RawSourcesTreeDataProvider } from './rawSourcesTree';
import { BacklinksTreeDataProvider } from './backlinksTree';
import { registerCommands } from './commands';
import { createStatusBar } from './statusBar';

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

  const backlinksProvider = new BacklinksTreeDataProvider(workspaceFolder);
  const backlinksRegistration = vscode.window.registerTreeDataProvider('backlinks', backlinksProvider);

  const watcher = vscode.workspace.createFileSystemWatcher('**/wiki/**/*.md');
  watcher.onDidChange(() => { wikiPagesProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidCreate(() => { wikiPagesProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidDelete(() => { wikiPagesProvider.refresh(); backlinksProvider.refresh(); });

  const rawSourcesProvider = new RawSourcesTreeDataProvider(workspaceFolder);
  const rawSourcesRegistration = vscode.window.registerTreeDataProvider('rawSources', rawSourcesProvider);

  const rawWatcher = vscode.workspace.createFileSystemWatcher('**/raw/**');
  rawWatcher.onDidChange(() => rawSourcesProvider.refresh());
  rawWatcher.onDidCreate(() => rawSourcesProvider.refresh());
  rawWatcher.onDidDelete(() => rawSourcesProvider.refresh());

  registerCommands(context, workspaceFolder, { wikiPages: wikiPagesProvider, rawSources: rawSourcesProvider }, outputChannel);

  const statusBar = createStatusBar(context, workspaceFolder);

  context.subscriptions.push(treeRegistration, watcher, wikiPagesProvider, rawSourcesRegistration, rawWatcher, rawSourcesProvider, backlinksRegistration, backlinksProvider, statusBar);
}

export function deactivate(): void {
  // Resources disposed via context.subscriptions
}

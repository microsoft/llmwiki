import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('LLM Wiki');
  outputChannel.appendLine('LLM Wiki extension activated');

  vscode.commands.executeCommand('setContext', 'llmwiki.isWikiWorkspace', true);

  context.subscriptions.push(outputChannel);
}

export function deactivate(): void {
  // Resources disposed via context.subscriptions
}

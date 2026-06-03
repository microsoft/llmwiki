import * as vscode from 'vscode';
import { join, relative } from 'node:path';
import { getBacklinks } from '@llmwiki/core';
import type { BacklinkResult } from '@llmwiki/core';

export class BacklinkTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      backlink?: BacklinkResult;
      message?: boolean;
    },
  ) {
    super(label, collapsibleState);

    if (options?.backlink) {
      this.contextValue = 'backlink';
      this.description = options.backlink.linkText;
      this.iconPath = new vscode.ThemeIcon('references');
      this.command = {
        command: 'vscode.open',
        title: 'Open Page',
        arguments: [vscode.Uri.file(options.backlink.sourcePage)],
      };
    } else if (options?.message) {
      this.contextValue = 'message';
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

export class BacklinksTreeDataProvider
  implements vscode.TreeDataProvider<BacklinkTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BacklinkTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly wikiDir: string;
  private readonly _editorListener: vscode.Disposable;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceFolder: string) {
    this.wikiDir = join(workspaceFolder, 'wiki');
    this._editorListener = vscode.window.onDidChangeActiveTextEditor(() => {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this.refresh();
      }, 200);
    });
  }

  getTreeItem(element: BacklinkTreeItem): BacklinkTreeItem {
    return element;
  }

  async getChildren(): Promise<BacklinkTreeItem[]> {
    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) {
      return [
        new BacklinkTreeItem(
          'Open a wiki page to see backlinks',
          vscode.TreeItemCollapsibleState.None,
          { message: true },
        ),
      ];
    }

    const fsPath = activeEditor.document.uri.fsPath;
    const normalizedPath = fsPath.replace(/\\/g, '/');
    const normalizedWikiDir = this.wikiDir.replace(/\\/g, '/');

    if (!normalizedPath.startsWith(normalizedWikiDir + '/')) {
      return [
        new BacklinkTreeItem(
          'Open a wiki page to see backlinks',
          vscode.TreeItemCollapsibleState.None,
          { message: true },
        ),
      ];
    }

    const targetPage = relative(this.wikiDir, fsPath).replace(/\\/g, '/');
    const results = await getBacklinks(this.wikiDir, targetPage);

    if (results.length === 0) {
      return [
        new BacklinkTreeItem(
          'No backlinks found',
          vscode.TreeItemCollapsibleState.None,
          { message: true },
        ),
      ];
    }

    return results.map(
      (backlink) =>
        new BacklinkTreeItem(
          backlink.sourceTitle,
          vscode.TreeItemCollapsibleState.None,
          { backlink },
        ),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this._editorListener.dispose();
    clearTimeout(this._debounceTimer);
  }
}

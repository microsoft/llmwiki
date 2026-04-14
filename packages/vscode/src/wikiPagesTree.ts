import * as vscode from 'vscode';
import { join } from 'node:path';
import { readIndex } from '@llmwiki/shared';
import type { IndexEntry } from '@llmwiki/shared';

export class WikiTreeItem extends vscode.TreeItem {
  readonly pagePath?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      entry?: IndexEntry;
      fullPath?: string;
    },
  ) {
    super(label, collapsibleState);

    if (options?.entry && options.fullPath) {
      this.contextValue = 'page';
      this.description = options.entry.summary;
      this.pagePath = options.fullPath;
      this.iconPath = new vscode.ThemeIcon('file-text');
      this.command = {
        command: 'vscode.open',
        title: 'Open Page',
        arguments: [vscode.Uri.file(options.fullPath)],
      };
    }
  }
}

/**
 * A flat tree provider that shows wiki pages filtered by category.
 * Used for separate Entities and Concepts sidebar sections.
 */
export class WikiPagesTreeDataProvider
  implements vscode.TreeDataProvider<WikiTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WikiTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly indexPath: string;
  private readonly category: string;

  constructor(
    private readonly workspaceFolder: string,
    category: string,
  ) {
    this.indexPath = join(workspaceFolder, 'wiki', 'index.md');
    this.category = category;
  }

  getTreeItem(element: WikiTreeItem): WikiTreeItem {
    return element;
  }

  async getChildren(): Promise<WikiTreeItem[]> {
    let entries: IndexEntry[];
    try {
      entries = await readIndex(this.indexPath);
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.category === this.category)
      .map((entry) => {
        const fullPath = join(this.workspaceFolder, 'wiki', entry.path);
        return new WikiTreeItem(
          entry.title,
          vscode.TreeItemCollapsibleState.None,
          { entry, fullPath },
        );
      });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

import * as vscode from 'vscode';
import { join } from 'node:path';
import { readIndex } from '@llmwiki/shared';
import type { IndexEntry } from '@llmwiki/shared';

export class WikiTreeItem extends vscode.TreeItem {
  readonly category?: string;
  readonly pagePath?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      category?: string;
      entry?: IndexEntry;
      fullPath?: string;
    },
  ) {
    super(label, collapsibleState);

    if (options?.entry && options.fullPath) {
      // Page item
      this.contextValue = 'page';
      this.description = options.entry.summary;
      this.iconPath = new vscode.ThemeIcon('file-text');
      this.pagePath = options.fullPath;
      this.command = {
        command: 'vscode.open',
        title: 'Open Page',
        arguments: [vscode.Uri.file(options.fullPath)],
      };
    } else if (options?.category) {
      // Category item
      this.contextValue = 'category';
      this.category = options.category;
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }
}

export class WikiPagesTreeDataProvider
  implements vscode.TreeDataProvider<WikiTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WikiTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly indexPath: string;

  constructor(private readonly workspaceFolder: string) {
    this.indexPath = join(workspaceFolder, 'wiki', 'index.md');
  }

  getTreeItem(element: WikiTreeItem): WikiTreeItem {
    return element;
  }

  async getChildren(element?: WikiTreeItem): Promise<WikiTreeItem[]> {
    if (element === undefined) {
      const entries = await readIndex(this.indexPath);
      const seen = new Set<string>();
      const categories: WikiTreeItem[] = [];

      for (const entry of entries) {
        if (!seen.has(entry.category)) {
          seen.add(entry.category);
          categories.push(
            new WikiTreeItem(
              entry.category,
              vscode.TreeItemCollapsibleState.Collapsed,
              { category: entry.category },
            ),
          );
        }
      }

      return categories;
    }

    if (element.contextValue === 'category') {
      const entries = await readIndex(this.indexPath);
      return entries
        .filter((entry) => entry.category === element.category)
        .map((entry) => {
          const fullPath = join(this.workspaceFolder, 'wiki', entry.path);
          return new WikiTreeItem(
            entry.title,
            vscode.TreeItemCollapsibleState.None,
            { entry, fullPath },
          );
        });
    }

    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

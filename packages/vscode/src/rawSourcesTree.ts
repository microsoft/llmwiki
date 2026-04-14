import * as vscode from 'vscode';
import { join, dirname, basename } from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { listSources } from '@llmwiki/shared';
import type { SourceFile } from '@llmwiki/shared';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(isoString: string): string {
  return isoString.slice(0, 10); // "2024-01-15"
}

export class RawSourceTreeItem extends vscode.TreeItem {
  readonly filePath?: string;
  readonly directory?: string;
  readonly isDirectory: boolean;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      sourceFile?: SourceFile;
      fullPath?: string;
      directory?: string;
    },
  ) {
    super(label, collapsibleState);
    this.isDirectory = !!options?.directory;

    if (options?.sourceFile && options.fullPath) {
      this.contextValue = 'rawSource';
      this.filePath = options.fullPath;
      this.description = `${formatSize(options.sourceFile.size)} • ${formatDate(options.sourceFile.modified)}`;
      this.iconPath = new vscode.ThemeIcon('file');
      this.command = {
        command: 'vscode.open',
        title: 'Open Source',
        arguments: [vscode.Uri.file(options.fullPath)],
      };
    } else if (options?.directory) {
      this.contextValue = 'rawSourceDir';
      this.directory = options.directory;
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }
}

export class RawSourcesTreeDataProvider
  implements vscode.TreeDataProvider<RawSourceTreeItem>, vscode.TreeDragAndDropController<RawSourceTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    RawSourceTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = ['text/uri-list'];
  readonly dragMimeTypes: string[] = [];

  private readonly rawDir: string;

  constructor(private readonly workspaceFolder: string) {
    this.rawDir = join(workspaceFolder, 'raw');
  }

  // ── Drag & Drop ────────────────────────────────────────────────

  handleDrag(): void {
    // We don't support dragging items out of this tree
  }

  async handleDrop(
    _target: RawSourceTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const uriListItem = dataTransfer.get('text/uri-list');
    if (!uriListItem) return;

    const raw = await uriListItem.asString();
    const uris = raw
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => vscode.Uri.parse(line.trim()));

    if (uris.length === 0) return;

    // Ensure raw/ directory exists
    await mkdir(this.rawDir, { recursive: true });

    let copied = 0;
    for (const uri of uris) {
      if (uri.scheme !== 'file') continue;
      const dest = join(this.rawDir, basename(uri.fsPath));
      try {
        await copyFile(uri.fsPath, dest);
        copied++;
      } catch (err) {
        vscode.window.showWarningMessage(`Failed to copy ${basename(uri.fsPath)}: ${err}`);
      }
    }

    if (copied > 0) {
      this.refresh();
      vscode.window.showInformationMessage(
        `Copied ${copied} file(s) to raw/. Use "LLM Wiki: Ingest Source" to process them.`,
      );
    }
  }

  getTreeItem(element: RawSourceTreeItem): RawSourceTreeItem {
    return element;
  }

  async getChildren(element?: RawSourceTreeItem): Promise<RawSourceTreeItem[]> {
    const sources = await listSources(this.rawDir);

    if (element === undefined) {
      const dirSet = new Set<string>();
      for (const source of sources) {
        const dir = dirname(source.path);
        if (dir !== '.') {
          dirSet.add(dir);
        }
      }

      if (dirSet.size === 0) {
        // All files are in root dir — return flat list
        return sources.map(
          (source) =>
            new RawSourceTreeItem(
              source.name,
              vscode.TreeItemCollapsibleState.None,
              {
                sourceFile: source,
                fullPath: join(this.rawDir, source.path),
              },
            ),
        );
      }

      // Mixed: directory items + root-level file items
      const items: RawSourceTreeItem[] = [];

      for (const dir of [...dirSet].sort()) {
        items.push(
          new RawSourceTreeItem(
            dir,
            vscode.TreeItemCollapsibleState.Collapsed,
            { directory: dir },
          ),
        );
      }

      for (const source of sources) {
        if (dirname(source.path) === '.') {
          items.push(
            new RawSourceTreeItem(
              source.name,
              vscode.TreeItemCollapsibleState.None,
              {
                sourceFile: source,
                fullPath: join(this.rawDir, source.path),
              },
            ),
          );
        }
      }

      return items;
    }

    if (element.contextValue === 'rawSourceDir') {
      return sources
        .filter((source) => dirname(source.path) === element.directory)
        .map(
          (source) =>
            new RawSourceTreeItem(
              source.name,
              vscode.TreeItemCollapsibleState.None,
              {
                sourceFile: source,
                fullPath: join(this.rawDir, source.path),
              },
            ),
        );
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

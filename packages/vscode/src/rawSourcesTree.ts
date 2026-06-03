import * as vscode from 'vscode';
import { join, dirname, basename } from 'node:path';
import { copyFile, mkdir, stat, readdir } from 'node:fs/promises';
import { listSources } from '@llmwiki/core';
import type { SourceFile } from '@llmwiki/core';

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
      placeholder?: boolean;
    },
  ) {
    super(label, collapsibleState);
    this.isDirectory = !!options?.directory;

    if (options?.placeholder) {
      // Empty-state placeholder. Keeping a real TreeItem here (instead of a
      // `viewsWelcome` markdown panel) ensures the tree's drag-and-drop
      // controller is active so users can drop files even when raw/ is empty.
      this.contextValue = 'rawSourcePlaceholder';
      this.iconPath = new vscode.ThemeIcon('cloud-upload');
      this.description = 'Drop files or folders here, or click to pick…';
      this.tooltip =
        'No sources yet. Drag files or folders from your OS or the VS Code Explorer onto this view, or click to open the picker.';
      this.command = {
        command: 'llmwiki.ingest',
        title: 'Ingest Files or Folder',
      };
    } else if (options?.sourceFile && options.fullPath) {
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

  // ── Drag & Drop ────────────────────────────────────────────────
  //
  // We accept both `text/uri-list` (used by external OS drags on most
  // platforms) and `application/vnd.code.uri-list` (used by VS Code's
  // internal drags from the Explorer or other tree views). Declaring both
  // is what makes VS Code highlight the entire Raw Sources view as a valid
  // drop target while the user hovers a file or folder over it.
  readonly dropMimeTypes = ['text/uri-list', 'application/vnd.code.uri-list'];
  readonly dragMimeTypes: string[] = [];

  private readonly rawDir: string;

  constructor(private readonly workspaceFolder: string) {
    this.rawDir = join(workspaceFolder, 'raw');
  }

  // ── Drag handlers ──────────────────────────────────────────────

  handleDrag(): void {
    // We don't support dragging items out of this tree
  }

  async handleDrop(
    _target: RawSourceTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Both MIME variants carry the same payload format — try each in order.
    const uriListItem =
      dataTransfer.get('text/uri-list') ??
      dataTransfer.get('application/vnd.code.uri-list');
    if (!uriListItem) return;

    const raw = await uriListItem.asString();
    const uris = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => vscode.Uri.parse(line));

    if (uris.length === 0) return;

    await mkdir(this.rawDir, { recursive: true });

    let copiedFiles = 0;
    let copiedFolders = 0;
    const failures: string[] = [];

    for (const uri of uris) {
      if (uri.scheme !== 'file') continue;
      const sourcePath = uri.fsPath;
      try {
        const info = await stat(sourcePath);
        if (info.isDirectory()) {
          // Recursively copy the entire folder into raw/, preserving its
          // top-level name so dropped folders remain grouped.
          const folderName = basename(sourcePath);
          const destRoot = join(this.rawDir, folderName);
          const filesCopied = await copyDirectoryRecursive(sourcePath, destRoot);
          if (filesCopied > 0) {
            copiedFolders++;
            copiedFiles += filesCopied;
          }
        } else if (info.isFile()) {
          const dest = join(this.rawDir, basename(sourcePath));
          await copyFile(sourcePath, dest);
          copiedFiles++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${basename(sourcePath)}: ${msg}`);
      }
    }

    if (copiedFiles > 0) {
      this.refresh();
      const folderSuffix = copiedFolders > 0 ? ` from ${copiedFolders} folder(s)` : '';
      vscode.window.showInformationMessage(
        `Copied ${copiedFiles} file(s)${folderSuffix} to raw/. Ingestion will start automatically.`,
      );
    } else if (failures.length === 0) {
      vscode.window.showInformationMessage('No files were copied — folders were empty or contained only hidden files.');
    }

    if (failures.length > 0) {
      vscode.window.showWarningMessage(
        `Failed to copy ${failures.length} item(s). See output channel for details.`,
      );
    }
  }

  getTreeItem(element: RawSourceTreeItem): RawSourceTreeItem {
    return element;
  }

  async getChildren(element?: RawSourceTreeItem): Promise<RawSourceTreeItem[]> {
    const sources = await listSources(this.rawDir);

    if (element === undefined) {
      // Empty raw/ → show a drop-zone placeholder so the drag-and-drop
      // controller stays active. Returning [] here would cause VS Code to
      // fall back to a `viewsWelcome` panel that cannot receive drops.
      if (sources.length === 0) {
        return [
          new RawSourceTreeItem(
            'No sources yet',
            vscode.TreeItemCollapsibleState.None,
            { placeholder: true },
          ),
        ];
      }

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

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Recursively copy every regular file under `src` into `dest`, preserving
 * the relative directory structure. Hidden files / dirs (those starting
 * with `.`) are skipped. Returns the number of files copied.
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<number> {
  let count = 0;
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

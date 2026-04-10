import * as vscode from 'vscode';
import { join, relative } from 'node:path';
import { readdir } from 'node:fs/promises';
import { readIndex, listPages, readLog, directoryExists } from '@llmwiki/shared';

const DEBOUNCE_MS = 300;

export class StatusBarManager implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private readonly _wikiWatcher: vscode.FileSystemWatcher;
  private readonly _rawWatcher: vscode.FileSystemWatcher;
  private readonly _eventDisposables: vscode.Disposable[] = [];
  private readonly _workspaceFolder: string;
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext, workspaceFolder: string) {
    this._workspaceFolder = workspaceFolder;

    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this._item.command = 'llmwiki.status';
    this._item.show();

    this._wikiWatcher = vscode.workspace.createFileSystemWatcher('**/wiki/**/*.md');
    this._rawWatcher = vscode.workspace.createFileSystemWatcher('**/raw/**');

    this._eventDisposables.push(
      this._wikiWatcher.onDidChange(() => this._debouncedRefresh()),
      this._wikiWatcher.onDidCreate(() => this._debouncedRefresh()),
      this._wikiWatcher.onDidDelete(() => this._debouncedRefresh()),
      this._rawWatcher.onDidChange(() => this._debouncedRefresh()),
      this._rawWatcher.onDidCreate(() => this._debouncedRefresh()),
      this._rawWatcher.onDidDelete(() => this._debouncedRefresh()),
    );

    // Initial refresh
    this._refresh().catch(() => {
      // silently ignore errors on initial load
    });
  }

  private _debouncedRefresh(): void {
    if (this._refreshTimer !== undefined) {
      clearTimeout(this._refreshTimer);
    }
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._refresh().catch(() => {
        // silently ignore errors
      });
    }, DEBOUNCE_MS);
  }

  private async _refresh(): Promise<void> {
    const wikiDir = join(this._workspaceFolder, 'wiki');
    const indexPath = join(wikiDir, 'index.md');
    const logPath = join(wikiDir, 'log.md');
    const rawDir = join(this._workspaceFolder, 'raw');

    const exists = await directoryExists(wikiDir);
    if (!exists) {
      this._item.text = '$(book) Wiki: Not initialized';
      this._item.tooltip = '';
      return;
    }

    // Source count
    let sourceCount = 0;
    try {
      const rawEntries = await readdir(rawDir, { withFileTypes: true, recursive: true });
      sourceCount = rawEntries.filter((e) => e.isFile()).length;
    } catch {
      // raw/ doesn't exist
    }

    // Page count
    const allPages = await listPages(wikiDir);
    const wikiPages = allPages.filter((p) => {
      const rel = relative(wikiDir, p).replace(/\\/g, '/');
      return rel !== 'index.md' && rel !== 'log.md';
    });
    const wikiPageCount = wikiPages.length;

    // Last ingest date
    const logEntries = await readLog(logPath);
    const ingestEntries = logEntries.filter((e) => e.verb.toLowerCase().includes('ingest'));
    const lastIngestDate = ingestEntries.length > 0
      ? ingestEntries[ingestEntries.length - 1].date
      : null;

    // Coverage
    const indexEntries = await readIndex(indexPath);
    const indexedPaths = new Set(indexEntries.map((e) => e.path));
    const orphanPageCount = wikiPages.filter((p) => {
      const rel = relative(wikiDir, p).replace(/\\/g, '/');
      return !indexedPaths.has(rel);
    }).length;
    const indexedPageCount = wikiPageCount - orphanPageCount;
    const coveragePct = wikiPageCount > 0
      ? Math.round((indexedPageCount / wikiPageCount) * 100)
      : 100;

    this._item.text = `$(book) Wiki: ${wikiPageCount} pages`;
    this._item.tooltip =
      `Sources: ${sourceCount} | Last ingest: ${lastIngestDate ?? 'never'} | Coverage: ${coveragePct}%`;
  }

  dispose(): void {
    if (this._refreshTimer !== undefined) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    for (const d of this._eventDisposables) {
      d.dispose();
    }
    this._wikiWatcher.dispose();
    this._rawWatcher.dispose();
    this._item.dispose();
  }
}

export function createStatusBar(
  context: vscode.ExtensionContext,
  workspaceFolder: string,
): StatusBarManager {
  return new StatusBarManager(context, workspaceFolder);
}

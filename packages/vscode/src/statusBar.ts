import * as vscode from 'vscode';
import { join } from 'node:path';
import { directoryExists, getWikiStatus, WIKI_DIR_NAME } from '@llmwiki/shared';

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

    // Scope watchers to this workspace folder so opening files from other
    // wikis doesn't trigger spurious refreshes.
    const workspaceUri = vscode.Uri.file(workspaceFolder);
    this._wikiWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceUri, `${WIKI_DIR_NAME}/wiki/**/*.md`),
    );
    this._rawWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceUri, `${WIKI_DIR_NAME}/raw/**`),
    );

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

    const exists = await directoryExists(wikiDir);
    if (!exists) {
      this._item.text = '$(book) Wiki: Not initialized';
      this._item.tooltip = '';
      return;
    }

    const status = await getWikiStatus(this._workspaceFolder);

    this._item.text = `$(book) Wiki: ${status.wiki_page_count} pages`;
    this._item.tooltip =
      `Sources: ${status.source_count} | Last ingest: ${status.last_ingest_date ?? 'never'} | Coverage: ${status.index_coverage_pct}%`;
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

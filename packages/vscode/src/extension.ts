import * as vscode from 'vscode';
import { join, basename } from 'node:path';
import { WikiPagesTreeDataProvider } from './wikiPagesTree';
import { RawSourcesTreeDataProvider } from './rawSourcesTree';
import { BacklinksTreeDataProvider } from './backlinksTree';
import { registerCommands } from './commands';
import { createStatusBar } from './statusBar';
import { registerChatParticipant } from './chatParticipant';
import { llmIngest } from './llmIngest';

import { WIKI_DIR_NAME } from '@llmwiki/shared';

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

  // .wiki is the project root passed to all shared functions
  const wikiProjectRoot = join(workspaceFolder, WIKI_DIR_NAME);

  const entitiesProvider = new WikiPagesTreeDataProvider(wikiProjectRoot, 'Entities');
  const entitiesRegistration = vscode.window.registerTreeDataProvider('entities', entitiesProvider);

  const conceptsProvider = new WikiPagesTreeDataProvider(wikiProjectRoot, 'Concepts');
  const conceptsRegistration = vscode.window.registerTreeDataProvider('concepts', conceptsProvider);

  const backlinksProvider = new BacklinksTreeDataProvider(wikiProjectRoot);
  const backlinksRegistration = vscode.window.registerTreeDataProvider('backlinks', backlinksProvider);

  const watcher = vscode.workspace.createFileSystemWatcher(`**/${WIKI_DIR_NAME}/wiki/**/*.md`);
  watcher.onDidChange(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidCreate(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidDelete(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });

  const rawSourcesProvider = new RawSourcesTreeDataProvider(wikiProjectRoot);
  const rawSourcesRegistration = vscode.window.createTreeView('rawSources', {
    treeDataProvider: rawSourcesProvider,
    dragAndDropController: rawSourcesProvider,
  });

  const rawWatcher = vscode.workspace.createFileSystemWatcher(`**/${WIKI_DIR_NAME}/raw/**`);
  rawWatcher.onDidChange(() => rawSourcesProvider.refresh());
  rawWatcher.onDidCreate((uri) => {
    rawSourcesProvider.refresh();
    // Auto-ingest new files with LLM
    autoIngest(uri, wikiProjectRoot, outputChannel, wikiProviders);
  });
  rawWatcher.onDidDelete((uri) => {
    rawSourcesProvider.refresh();
    // Auto-cleanup wiki pages created from this source
    autoCleanup(uri, wikiProjectRoot, outputChannel, wikiProviders);
  });

  const wikiProviders = { entities: entitiesProvider, concepts: conceptsProvider, rawSources: rawSourcesProvider };
  registerCommands(context, workspaceFolder, wikiProjectRoot, wikiProviders, outputChannel);
  registerChatParticipant(context, workspaceFolder, outputChannel);

  // Fix button opens @wiki /fix in chat
  context.subscriptions.push(
    vscode.commands.registerCommand('llmwiki.fix', () => {
      vscode.commands.executeCommand('workbench.action.chat.open', { query: '@wiki /fix' });
    }),
  );

  const statusBar = createStatusBar(context, wikiProjectRoot);

  context.subscriptions.push(entitiesRegistration, conceptsRegistration, watcher, entitiesProvider, conceptsProvider, rawSourcesRegistration, rawWatcher, rawSourcesProvider, backlinksRegistration, backlinksProvider, statusBar);
}

export function deactivate(): void {
  // Resources disposed via context.subscriptions
}

// ── Auto-ingest on raw file creation ─────────────────────────────

const _pendingIngests = new Set<string>();

async function autoIngest(
  uri: vscode.Uri,
  wikiProjectRoot: string,
  outputChannel: vscode.OutputChannel,
  providers: { entities: WikiPagesTreeDataProvider; concepts: WikiPagesTreeDataProvider; rawSources: RawSourcesTreeDataProvider },
): Promise<void> {
  const filePath = uri.fsPath;

  // Deduplicate — file watchers can fire multiple times
  if (_pendingIngests.has(filePath)) return;
  _pendingIngests.add(filePath);

  try {
    // Small delay to let file writes finish (e.g. drag-and-drop, copy)
    await new Promise((resolve) => setTimeout(resolve, 500));

    outputChannel.appendLine(`[autoIngest] New source detected: ${filePath}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Ingesting ${uri.path.split('/').pop()}…`,
        cancellable: true,
      },
      async (progress, token) => {
        return llmIngest(filePath, wikiProjectRoot, false, outputChannel, progress, token);
      },
    );

    providers.entities.refresh();
    providers.concepts.refresh();
    providers.rawSources.refresh();
    outputChannel.appendLine(`[autoIngest] Completed: ${filePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[autoIngest] Failed: ${msg}`);
    // Don't show error for skipped (already ingested) files
    if (!msg.includes('already ingested')) {
      vscode.window.showWarningMessage(`Auto-ingest failed for ${uri.path.split('/').pop()}: ${msg}`);
    }
  } finally {
    _pendingIngests.delete(filePath);
  }
}

// ── Auto-cleanup on raw file deletion ───────────────────────────

async function autoCleanup(
  uri: vscode.Uri,
  wikiProjectRoot: string,
  outputChannel: vscode.OutputChannel,
  providers: { entities: WikiPagesTreeDataProvider; concepts: WikiPagesTreeDataProvider; rawSources: RawSourcesTreeDataProvider },
): Promise<void> {
  const { slugify, deletePage, readPage, appendEntry } = await import('@llmwiki/shared');
  const { readdir } = await import('node:fs/promises');
  const { extname } = await import('node:path');
  const wikiDir = join(wikiProjectRoot, 'wiki');
  const logPath = join(wikiDir, 'log.md');
  const fileName = basename(uri.fsPath);
  const slug = slugify(fileName);
  const summaryRelPath = `sources/${slug}-summary.md`;

  outputChannel.appendLine(`[autoCleanup] Source removed: ${fileName}, looking for ${summaryRelPath}`);

  let removedCount = 0;

  // Delete summary page
  try {
    await deletePage(wikiDir, summaryRelPath);
    removedCount++;
    outputChannel.appendLine(`[autoCleanup] Deleted summary: ${summaryRelPath}`);
  } catch {
    // May not exist
  }

  // Delete entity/concept pages tagged with this source
  try {
    const allFiles = await readdir(wikiDir, { recursive: true }) as string[];
    const mdPages = allFiles
      .filter((f) => typeof f === 'string' && extname(f) === '.md')
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f !== 'index.md' && f !== 'log.md');

    for (const relPath of mdPages) {
      try {
        const page = await readPage(join(wikiDir, relPath));
        const sources = page.frontmatter.sources as string[] | undefined;
        if (sources && sources.includes(summaryRelPath)) {
          await deletePage(wikiDir, relPath);
          removedCount++;
          outputChannel.appendLine(`[autoCleanup] Deleted tagged page: ${relPath}`);
        }
      } catch {
        // Skip unreadable pages
      }
    }
  } catch (err) {
    outputChannel.appendLine(`[autoCleanup] Error scanning pages: ${err}`);
  }

  if (removedCount > 0) {
    try {
      await appendEntry(logPath, {
        verb: 'removed',
        subject: fileName,
        details: `Auto-cleanup: ${removedCount} wiki page(s) removed.`,
      });
    } catch {
      // Log may not exist
    }

    providers.entities.refresh();
    providers.concepts.refresh();
    vscode.window.showInformationMessage(`Removed ${removedCount} wiki page(s) for "${fileName}".`);
  }

  outputChannel.appendLine(`[autoCleanup] Done: ${removedCount} page(s) removed`);
}

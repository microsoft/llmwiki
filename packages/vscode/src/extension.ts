import * as vscode from 'vscode';
import { join, basename } from 'node:path';
import { WikiPagesTreeDataProvider } from './wikiPagesTree';
import { RawSourcesTreeDataProvider } from './rawSourcesTree';
import { BacklinksTreeDataProvider } from './backlinksTree';
import { registerCommands } from './commands';
import { createStatusBar } from './statusBar';
import { registerChatParticipant } from './chatParticipant';
import { llmIngest } from './llmIngest';
import { registerMcpServerProvider } from './mcpProvider';

import { WIKI_DIR_NAME, directoryExists, slugify } from '@llmwiki/shared';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('LLM Wiki');
  outputChannel.appendLine('LLM Wiki extension activated');

  context.subscriptions.push(outputChannel);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    outputChannel.appendLine('No workspace folder found — showing open-folder prompt');
    vscode.commands.executeCommand('setContext', 'llmwiki.noFolder', true);
    vscode.commands.executeCommand('setContext', 'llmwiki.isWikiWorkspace', false);
    return;
  }
  vscode.commands.executeCommand('setContext', 'llmwiki.noFolder', false);

  const wikiProjectRoot = join(workspaceFolder, WIKI_DIR_NAME);
  const wikiDir = join(wikiProjectRoot, 'wiki');

  // Bootstrap: check if wiki exists, then set up views accordingly
  bootstrapViews(context, workspaceFolder, wikiProjectRoot, wikiDir);
}

async function bootstrapViews(
  context: vscode.ExtensionContext,
  workspaceFolder: string,
  wikiProjectRoot: string,
  wikiDir: string,
): Promise<void> {
  const wikiExists = await directoryExists(wikiDir);
  vscode.commands.executeCommand('setContext', 'llmwiki.isWikiWorkspace', wikiExists);

  if (!wikiExists) {
    // Register only the init command so the welcome view button works
    const initDisposable = vscode.commands.registerCommand('llmwiki.init', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Initializing LLM Wiki…', cancellable: false },
        async () => {
          const { initWiki } = await import('@llmwiki/shared');
          const result = await initWiki(workspaceFolder);
          vscode.window.showInformationMessage(
            `Wiki initialized in .wiki/: ${result.created_dirs.length} directories, ${result.created_files.length} files created.`,
          );
          // Dispose this temporary registration so registerCommands can re-register it
          initDisposable.dispose();
          // Now that the wiki exists, set context and register full views
          vscode.commands.executeCommand('setContext', 'llmwiki.isWikiWorkspace', true);
          registerFullViews(context, workspaceFolder, wikiProjectRoot);
        },
      );
    });
    context.subscriptions.push(initDisposable);
    outputChannel.appendLine('No wiki found — showing initialization welcome view');
    return;
  }

  registerFullViews(context, workspaceFolder, wikiProjectRoot);
}

function registerFullViews(
  context: vscode.ExtensionContext,
  workspaceFolder: string,
  wikiProjectRoot: string,
): void {
  // .wiki is the project root passed to all shared functions

  const entitiesProvider = new WikiPagesTreeDataProvider(wikiProjectRoot, 'Entities');
  const entitiesRegistration = vscode.window.registerTreeDataProvider('entities', entitiesProvider);

  const conceptsProvider = new WikiPagesTreeDataProvider(wikiProjectRoot, 'Concepts');
  const conceptsRegistration = vscode.window.registerTreeDataProvider('concepts', conceptsProvider);

  const backlinksProvider = new BacklinksTreeDataProvider(wikiProjectRoot);
  const backlinksRegistration = vscode.window.registerTreeDataProvider('backlinks', backlinksProvider);

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, `${WIKI_DIR_NAME}/wiki/**/*.md`),
  );
  watcher.onDidChange(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidCreate(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });
  watcher.onDidDelete(() => { entitiesProvider.refresh(); conceptsProvider.refresh(); backlinksProvider.refresh(); });

  const rawSourcesProvider = new RawSourcesTreeDataProvider(wikiProjectRoot);
  const rawSourcesRegistration = vscode.window.createTreeView('rawSources', {
    treeDataProvider: rawSourcesProvider,
    dragAndDropController: rawSourcesProvider,
  });

  // Use RelativePattern with absolute workspace root — bare-string globs through
  // dot-prefixed directories (`.wiki/`) are unreliable on Windows because the
  // underlying file watcher often honours `files.watcherExclude` defaults that
  // skip hidden directories.
  const rawWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, `${WIKI_DIR_NAME}/raw/**`),
  );
  outputChannel.appendLine(
    `[watcher] Watching ${join(workspaceFolder, WIKI_DIR_NAME, 'raw')} for new sources`,
  );
  rawWatcher.onDidChange((uri) => {
    outputChannel.appendLine(`[watcher] onDidChange: ${uri.fsPath}`);
    rawSourcesProvider.refresh();
  });
  rawWatcher.onDidCreate((uri) => {
    outputChannel.appendLine(`[watcher] onDidCreate: ${uri.fsPath}`);
    rawSourcesProvider.refresh();
    // Auto-ingest new files with LLM
    autoIngest(uri, wikiProjectRoot, outputChannel, wikiProviders);
  });
  rawWatcher.onDidDelete((uri) => {
    outputChannel.appendLine(`[watcher] onDidDelete: ${uri.fsPath}`);
    rawSourcesProvider.refresh();
    // Auto-cleanup wiki pages created from this source
    autoCleanup(uri, wikiProjectRoot, outputChannel, wikiProviders);
  });

  const wikiProviders = { entities: entitiesProvider, concepts: conceptsProvider, rawSources: rawSourcesProvider };
  registerCommands(context, workspaceFolder, wikiProjectRoot, wikiProviders, outputChannel);
  registerChatParticipant(context, workspaceFolder, outputChannel);
  registerMcpServerProvider(context, workspaceFolder, outputChannel);

  // Fix button opens @wiki /fix in chat
  context.subscriptions.push(
    vscode.commands.registerCommand('llmwiki.fix', () => {
      vscode.commands.executeCommand('workbench.action.chat.open', { query: '@wiki /fix' });
    }),
  );

  const statusBar = createStatusBar(context, wikiProjectRoot);

  context.subscriptions.push(entitiesRegistration, conceptsRegistration, watcher, entitiesProvider, conceptsProvider, rawSourcesRegistration, rawWatcher, rawSourcesProvider, backlinksRegistration, backlinksProvider, statusBar);

  // Manual scan command — also resilient backup if the watcher misses an event.
  context.subscriptions.push(
    vscode.commands.registerCommand('llmwiki.scanRaw', () =>
      scanRawForUningested(wikiProjectRoot, outputChannel, wikiProviders, true),
    ),
  );

  // Startup scan — picks up any files added to raw/ while the extension
  // wasn't running, or that the watcher silently missed.
  void scanRawForUningested(wikiProjectRoot, outputChannel, wikiProviders, false);
}

export function deactivate(): void {
  // Resources disposed via context.subscriptions
}

// ── Scan raw/ for files without a matching wiki/sources/{slug}-summary.md ──

async function scanRawForUningested(
  wikiProjectRoot: string,
  outputChannel: vscode.OutputChannel,
  providers: { entities: WikiPagesTreeDataProvider; concepts: WikiPagesTreeDataProvider; rawSources: RawSourcesTreeDataProvider },
  interactive: boolean,
): Promise<void> {
  const rawDir = join(wikiProjectRoot, 'raw');
  const sourcesDir = join(wikiProjectRoot, 'wiki', 'sources');

  try {
    const { readdir, stat } = await import('node:fs/promises');
    const { extname } = await import('node:path');

    // Walk raw/ recursively, collect every regular file
    const rawFiles: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) rawFiles.push(full);
      }
    }
    try {
      await walk(rawDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[scan] Could not read raw/: ${msg}`);
      if (interactive) {
        vscode.window.showWarningMessage(`LLM Wiki: ${msg}`);
      }
      return;
    }

    // Snapshot existing summary pages so we can dedupe O(1)
    const existingSummaries = new Set<string>();
    try {
      const summaryFiles = (await readdir(sourcesDir)) as string[];
      for (const f of summaryFiles) {
        if (extname(f) === '.md') existingSummaries.add(f);
      }
    } catch {
      // sources/ may not exist yet — treat as empty
    }

    const orphans = rawFiles.filter((filePath) => {
      const slug = slugify(basename(filePath));
      return !existingSummaries.has(`${slug}-summary.md`);
    });

    outputChannel.appendLine(
      `[scan] ${rawFiles.length} file(s) in raw/, ${orphans.length} not yet ingested`,
    );

    if (orphans.length === 0) {
      if (interactive) {
        vscode.window.showInformationMessage('LLM Wiki: All sources are already ingested.');
      }
      return;
    }

    if (interactive && orphans.length > 5) {
      const choice = await vscode.window.showInformationMessage(
        `LLM Wiki: Found ${orphans.length} un-ingested source(s). Ingest now?`,
        { modal: true },
        'Ingest All',
      );
      if (choice !== 'Ingest All') return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Ingesting ${orphans.length} un-ingested source(s)…`,
        cancellable: true,
      },
      async (progress, token) => {
        for (let i = 0; i < orphans.length; i++) {
          if (token.isCancellationRequested) break;
          const filePath = orphans[i];
          progress.report({
            message: `${i + 1}/${orphans.length}: ${basename(filePath)}`,
            increment: 100 / orphans.length,
          });
          try {
            await llmIngest(filePath, wikiProjectRoot, false, outputChannel, progress, token);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[scan] Failed for ${filePath}: ${msg}`);
          }
        }
      },
    );

    providers.entities.refresh();
    providers.concepts.refresh();
    providers.rawSources.refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[scan] Error: ${msg}`);
    if (interactive) {
      vscode.window.showErrorMessage(`LLM Wiki: scan failed — ${msg}`);
    }
  }
}

// ── Auto-ingest on raw file creation ─────────────────────────────

const _pendingIngests = new Set<string>();

async function autoIngest(
  uri: vscode.Uri,
  wikiProjectRoot: string,
  outputChannel: vscode.OutputChannel,
  providers: { entities: WikiPagesTreeDataProvider; concepts: WikiPagesTreeDataProvider; rawSources: RawSourcesTreeDataProvider },
): Promise<void> {
  // Skip directories — file watchers fire for both files and folders
  const fileStat = await vscode.workspace.fs.stat(uri);
  if (fileStat.type === vscode.FileType.Directory) return;

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

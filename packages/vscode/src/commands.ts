import * as vscode from 'vscode';
import { join, resolve, basename, extname } from 'node:path';
import { writeFile, mkdir, copyFile, unlink, readdir } from 'node:fs/promises';
import {
  readIndex,
  directoryExists,
  appendEntry,
  initWiki,
  lintWiki,
  queryWiki,
  getWikiStatus,
  isNotFoundError,
  deletePage,
  readPage,
  slugify,
  type IndexEntry,
} from '@llmwiki/shared';
import { llmIngest } from './llmIngest';
import type { WikiPagesTreeDataProvider } from './wikiPagesTree';
import type { RawSourcesTreeDataProvider } from './rawSourcesTree';

/**
 * If the selected file is outside the workspace, copy it into raw/ first.
 * Returns the path inside raw/ (or the original path if already inside).
 */
async function ensureInRaw(
  filePath: string,
  rawDir: string,
  workspaceFolder: string,
): Promise<string> {
  const resolved = resolve(filePath).replace(/\\/g, '/');
  const root = resolve(workspaceFolder).replace(/\\/g, '/');
  if (resolved.startsWith(root + '/') || resolved === root) {
    return filePath; // already inside workspace
  }
  // External file — copy to raw/
  await mkdir(rawDir, { recursive: true });
  const dest = join(rawDir, basename(filePath));
  await copyFile(filePath, dest);
  return dest;
}

interface TreeProviders {
  entities: WikiPagesTreeDataProvider;
  concepts: WikiPagesTreeDataProvider;
  rawSources: RawSourcesTreeDataProvider;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  projectFolder: string,
  workspaceFolder: string,
  providers: TreeProviders,
  outputChannel: vscode.OutputChannel,
): void {
  const reg = (id: string, handler: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await handler();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine(`[${id}] Error: ${msg}`);
          vscode.window.showErrorMessage(`LLM Wiki: ${msg}`);
        }
      }),
    );
  };

  const wikiDir = join(workspaceFolder, 'wiki');
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');
  const rawDir = join(workspaceFolder, 'raw');

  // ── llmwiki.init ─────────────────────────────────────────────
  reg('llmwiki.init', async () => {
    // Check if already initialized
    if (await directoryExists(wikiDir)) {
      vscode.window.showWarningMessage('Wiki is already initialized (wiki/ directory exists).');
      return;
    }

    const result = await initWiki(projectFolder);

    vscode.window.showInformationMessage(
      `Wiki initialized in .wiki/: ${result.created_dirs.length} directories, ${result.created_files.length} files created.`,
    );
    providers.entities.refresh(); providers.concepts.refresh();
  });

  // ── llmwiki.ingest ───────────────────────────────────────────
  reg('llmwiki.ingest', async () => {
    if (!(await directoryExists(wikiDir))) {
      const choice = await vscode.window.showWarningMessage(
        'Wiki not initialized.', 'Initialize Now',
      );
      if (choice === 'Initialize Now') {
        await vscode.commands.executeCommand('llmwiki.init');
      }
      return;
    }

    const rawUri = vscode.Uri.file(rawDir);
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      defaultUri: rawUri,
      openLabel: 'Ingest',
      title: 'Select source file(s) to ingest',
    });
    if (!selected || selected.length === 0) return;

    let totalCreated = 0;
    let totalUpdated = 0;
    let succeeded = 0;
    let failed = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Ingesting files…',
        cancellable: true,
      },
      async (progress, cancelToken) => {
        const total = selected.length;
        for (let i = 0; i < total; i++) {
          if (cancelToken.isCancellationRequested) break;

          const uri = selected[i];
          const fileName = uri.fsPath.split(/[\\/]/).pop() ?? 'file';
          progress.report({ message: `(${i + 1}/${total}) ${fileName}`, increment: (100 / total) });

          try {
            const sourcePath = await ensureInRaw(uri.fsPath, rawDir, workspaceFolder);
            const result = await llmIngest(sourcePath, workspaceFolder, false, outputChannel, progress, cancelToken);
            totalCreated += result.pagesCreated.length;
            totalUpdated += result.pagesUpdated.length;
            succeeded++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[ingest] Failed ${fileName}: ${msg}`);
            failed++;
          }
        }
      },
    );

    const parts = [`${succeeded} file(s) ingested`];
    if (totalCreated > 0) parts.push(`${totalCreated} pages created`);
    if (totalUpdated > 0) parts.push(`${totalUpdated} pages updated`);
    if (failed > 0) parts.push(`${failed} failed`);
    vscode.window.showInformationMessage(`Ingest complete — ${parts.join(', ')}`);
    providers.entities.refresh(); providers.concepts.refresh();
    providers.rawSources.refresh();
  });

  // ── llmwiki.removeSource ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('llmwiki.removeSource', async (item?: { filePath?: string }) => {
      try {
        const filePath = item?.filePath;
        if (!filePath) return;

        const fileName = basename(filePath);
        const confirm = await vscode.window.showWarningMessage(
          `Remove "${fileName}" and its wiki pages?`,
          { modal: true },
          'Remove',
        );
        if (confirm !== 'Remove') return;

        // Delete the raw source file
        await unlink(filePath);
        outputChannel.appendLine(`[removeSource] Deleted raw file: ${filePath}`);

        // Delete the corresponding summary page + index entry
        const slug = slugify(fileName);
        const summaryRelPath = `sources/${slug}-summary.md`;
        try {
          await deletePage(wikiDir, summaryRelPath);
          outputChannel.appendLine(`[removeSource] Deleted wiki page: ${summaryRelPath}`);
        } catch {
          // Summary page may not exist (never ingested)
        }

        // Delete entity/concept pages that were created from this source
        let removedPages = 0;
        try {
          const allFiles = await readdir(wikiDir, { recursive: true }) as unknown as string[];
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
                removedPages++;
                outputChannel.appendLine(`[removeSource] Deleted tagged page: ${relPath}`);
              }
            } catch {
              // Skip unreadable pages
            }
          }
        } catch {
          // readdir may fail if wiki dir is empty
        }

        // Log the removal
        await appendEntry(logPath, {
          verb: 'removed',
          subject: fileName,
          details: `Source file and ${removedPages + 1} wiki pages removed.`,
        });

        providers.entities.refresh(); providers.concepts.refresh();
        providers.rawSources.refresh();
        const pageCount = removedPages + 1; // summary + tagged pages
        vscode.window.showInformationMessage(`Removed "${fileName}" and ${pageCount} wiki page(s).`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[removeSource] Error: ${msg}`);
        vscode.window.showErrorMessage(`LLM Wiki: ${msg}`);
      }
    }),
  );

  // ── llmwiki.query ────────────────────────────────────────────
  reg('llmwiki.query', async () => {
    if (!(await directoryExists(wikiDir))) {
      vscode.window.showWarningMessage('Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.');
      return;
    }

    const queryStr = await vscode.window.showInputBox({
      prompt: 'Search the wiki',
      placeHolder: 'Enter search terms…',
    });
    if (!queryStr) return;

    const output = await queryWiki(queryStr, workspaceFolder, false);

    if (output.matches === 0) {
      vscode.window.showInformationMessage(`No results for "${queryStr}".`);
      return;
    }

    const items = output.results.map((r) => ({
      label: r.title,
      description: `Score: ${r.score}`,
      detail: r.excerpt,
      path: r.path,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${output.matches} result(s) for "${queryStr}"`,
      matchOnDetail: true,
    });
    if (pick) {
      const uri = vscode.Uri.file(join(wikiDir, pick.path));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  });

  // ── llmwiki.status ───────────────────────────────────────────
  reg('llmwiki.status', async () => {
    const status = await getWikiStatus(workspaceFolder);

    const lines = [
      `Pages: ${status.wiki_page_count}`,
      `Sources: ${status.source_count}`,
      `Coverage: ${status.index_coverage_pct}%`,
      `Last ingest: ${status.last_ingest_date ?? '—'}`,
      `Orphans: ${status.orphan_page_count}`,
    ];
    vscode.window.showInformationMessage(`Wiki Status — ${lines.join(' | ')}`);
  });

  // ── llmwiki.openPage ─────────────────────────────────────────
  reg('llmwiki.openPage', async () => {
    let entries: IndexEntry[];
    try {
      entries = await readIndex(indexPath);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      vscode.window.showWarningMessage('Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.');
      return;
    }

    if (entries.length === 0) {
      vscode.window.showInformationMessage('No pages in the wiki yet.');
      return;
    }

    const items = entries.map((e) => ({
      label: e.title,
      description: e.category,
      detail: e.summary,
      path: e.path,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a wiki page to open',
      matchOnDetail: true,
    });
    if (pick) {
      const uri = vscode.Uri.file(join(wikiDir, pick.path));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  });

  // ── llmwiki.search ──────────────────────────────────────────
  reg('llmwiki.search', async () => {
    if (!(await directoryExists(wikiDir))) {
      vscode.window.showWarningMessage('Wiki not initialized.');
      return;
    }

    const queryStr = await vscode.window.showInputBox({
      prompt: 'Search entities and concepts',
      placeHolder: 'Enter search terms…',
    });
    if (!queryStr) return;

    let entries: IndexEntry[] = [];
    try {
      entries = await readIndex(indexPath);
    } catch {
      return;
    }

    // Filter to entities and concepts only, match by title/summary
    const q = queryStr.toLowerCase();
    const matches = entries
      .filter((e) => e.category === 'Entities' || e.category === 'Concepts')
      .filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .map((e) => ({
        label: `$(${e.category === 'Entities' ? 'person' : 'lightbulb'}) ${e.title}`,
        description: e.category,
        detail: e.summary,
        path: e.path,
      }));

    if (matches.length === 0) {
      vscode.window.showInformationMessage(`No entities or concepts matching "${queryStr}".`);
      return;
    }

    const pick = await vscode.window.showQuickPick(matches, {
      placeHolder: `${matches.length} result(s) for "${queryStr}"`,
      matchOnDetail: true,
    });
    if (pick) {
      const uri = vscode.Uri.file(join(wikiDir, pick.path));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  });

  // ── llmwiki.searchRaw ───────────────────────────────────────
  reg('llmwiki.searchRaw', async () => {
    const { listSources } = await import('@llmwiki/shared');
    const sources = await listSources(rawDir);

    if (sources.length === 0) {
      vscode.window.showInformationMessage('No source files in raw/.');
      return;
    }

    const queryStr = await vscode.window.showInputBox({
      prompt: 'Search source files',
      placeHolder: 'Enter filename…',
    });
    if (!queryStr) return;

    const q = queryStr.toLowerCase();
    const matches = sources
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => ({
        label: `$(file) ${s.name}`,
        description: `${s.size} bytes`,
        path: s.path,
      }));

    if (matches.length === 0) {
      vscode.window.showInformationMessage(`No sources matching "${queryStr}".`);
      return;
    }

    const pick = await vscode.window.showQuickPick(matches, {
      placeHolder: `${matches.length} source(s) matching "${queryStr}"`,
    });
    if (pick) {
      const uri = vscode.Uri.file(join(rawDir, pick.path));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  });

  // ── llmwiki.refresh ─────────────────────────────────────────
  reg('llmwiki.refresh', async () => {
    if (!(await directoryExists(wikiDir))) {
      providers.entities.refresh(); providers.concepts.refresh();
      providers.rawSources.refresh();
      return;
    }

    // Step 1: Delete entity/concept pages whose source no longer exists
    let cleanedPages = 0;
    try {
      const allFiles = await readdir(wikiDir, { recursive: true }) as unknown as string[];
      const mdPages = allFiles
        .filter((f) => typeof f === 'string' && extname(f) === '.md')
        .map((f) => f.replace(/\\/g, '/'))
        .filter((f) => f.startsWith('entities/') || f.startsWith('concepts/'));

      for (const relPath of mdPages) {
        try {
          const page = await readPage(join(wikiDir, relPath));
          const sources = page.frontmatter.sources as string[] | undefined;
          if (sources && sources.length > 0) {
            // Check if all referenced source pages still exist
            const { stat: fsStat } = await import('node:fs/promises');
            const allMissing = (await Promise.all(
              sources.map(async (s) => {
                try { await fsStat(join(wikiDir, s)); return false; }
                catch { return true; }
              }),
            )).every(Boolean);

            if (allMissing) {
              await deletePage(wikiDir, relPath);
              cleanedPages++;
              outputChannel.appendLine(`[refresh] Cleaned orphaned page: ${relPath}`);
            }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // readdir may fail
    }

    // Step 2: Run lint-fix to resolve stale entries, missing index, frontmatter
    const { lintFix } = await import('@llmwiki/shared');
    const fixResult = await lintFix(workspaceFolder, { fixOrphans: true });

    // Step 3: Check remaining issues
    const remaining = fixResult.remaining.filter((f) => f.severity === 'error' || f.severity === 'warning');

    providers.entities.refresh(); providers.concepts.refresh();
    providers.rawSources.refresh();

    const parts: string[] = [];
    if (cleanedPages > 0) parts.push(`${cleanedPages} orphaned page(s) removed`);
    if (fixResult.fixedCount > 0) parts.push(`${fixResult.fixedCount} issue(s) fixed`);
    if (remaining.length > 0) parts.push(`${remaining.length} issue(s) remaining`);

    if (parts.length === 0) {
      vscode.window.showInformationMessage('Wiki refreshed — no issues found ✓');
    } else if (remaining.length === 0) {
      vscode.window.showInformationMessage(`Wiki refreshed — ${parts.join(', ')} ✓`);
    } else {
      vscode.window.showWarningMessage(`Wiki refreshed — ${parts.join(', ')}. Use @wiki /lint for details.`);
    }
  });
}

import * as vscode from 'vscode';
import { join, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  readIndex,
  directoryExists,
  lintWiki,
  appendEntry,
  ingestSource,
  queryWiki,
  getWikiStatus,
  type IndexEntry,
} from '@llmwiki/shared';
import type { WikiPagesTreeDataProvider } from './wikiPagesTree';
import type { RawSourcesTreeDataProvider } from './rawSourcesTree';
import type { LintFindingsTreeDataProvider } from './lintFindingsTree';

interface TreeProviders {
  wikiPages: WikiPagesTreeDataProvider;
  rawSources: RawSourcesTreeDataProvider;
  lintFindings: LintFindingsTreeDataProvider;
}

export function registerCommands(
  context: vscode.ExtensionContext,
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
    const root = resolve(workspaceFolder);

    // Check if already initialized
    if (await directoryExists(wikiDir)) {
      vscode.window.showWarningMessage('Wiki is already initialized (wiki/ directory exists).');
      return;
    }

    const dirs = ['raw', 'wiki', 'wiki/entities', 'wiki/concepts', 'wiki/sources'];
    for (const dir of dirs) {
      await mkdir(join(root, dir), { recursive: true });
    }

    await writeFile(
      indexPath,
      '# Wiki Index\n\n## Entities\n\n## Concepts\n\n## Sources\n',
      'utf-8',
    );

    await appendEntry(logPath, {
      verb: 'initialized',
      subject: 'wiki',
      details: 'Wiki knowledge base initialized.',
    });

    await writeFile(
      join(root, 'AGENTS.md'),
      '# AGENTS.md\n\n## Wiki Schema\n\n_See CLI docs for full schema._\n',
      'utf-8',
    );

    vscode.window.showInformationMessage(
      `Wiki initialized: ${dirs.length} directories, 3 files created.`,
    );
    providers.wikiPages.refresh();
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
      canSelectMany: false,
      defaultUri: rawUri,
      openLabel: 'Ingest',
      title: 'Select a source file to ingest',
    });
    if (!selected || selected.length === 0) return;

    const sourcePath = selected[0].fsPath;
    const result = await ingestSource(sourcePath, workspaceFolder, false);

    if (result.status === 'error') {
      vscode.window.showErrorMessage(result.error ?? 'Ingest failed.');
      return;
    }

    vscode.window.showInformationMessage(`Ingested: ${result.pages_created.join(', ')}`);
    providers.wikiPages.refresh();
  });

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

  // ── llmwiki.lint ─────────────────────────────────────────────
  reg('llmwiki.lint', async () => {
    if (!(await directoryExists(wikiDir))) {
      vscode.window.showWarningMessage('Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.');
      return;
    }

    const result = await lintWiki(workspaceFolder);
    providers.lintFindings.setFindings(result.findings);

    const parts: string[] = [];
    if (result.errorCount > 0) parts.push(`${result.errorCount} error(s)`);
    if (result.warningCount > 0) parts.push(`${result.warningCount} warning(s)`);

    if (parts.length === 0) {
      vscode.window.showInformationMessage('Lint: no issues found ✓');
    } else {
      const summary = parts.join(', ');
      if (result.errorCount > 0) {
        vscode.window.showWarningMessage(`Lint: ${summary}`);
      } else {
        vscode.window.showInformationMessage(`Lint: ${summary}`);
      }
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
    } catch {
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

  // ── llmwiki.refresh ──────────────────────────────────────────
  reg('llmwiki.refresh', async () => {
    providers.wikiPages.refresh();
    providers.rawSources.refresh();
    vscode.window.showInformationMessage('LLM Wiki: views refreshed.');
  });
}

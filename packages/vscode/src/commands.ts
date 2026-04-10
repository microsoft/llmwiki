import * as vscode from 'vscode';
import { join, resolve, basename, extname, relative } from 'node:path';
import { readFile, writeFile, readdir, mkdir, stat, access, constants } from 'node:fs/promises';
import {
  readIndex,
  readPage,
  writePage,
  listPages,
  getPageLinks,
  readLog,
  addEntry,
  appendEntry,
  directoryExists,
  type IndexEntry,
} from '@llmwiki/shared';
import type { WikiPagesTreeDataProvider } from './wikiPagesTree';
import type { RawSourcesTreeDataProvider } from './rawSourcesTree';

interface TreeProviders {
  wikiPages: WikiPagesTreeDataProvider;
  rawSources: RawSourcesTreeDataProvider;
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
    const root = resolve(workspaceFolder);

    // Path traversal check
    const normalizedSource = resolve(sourcePath).replace(/\\/g, '/');
    const normalizedRoot = root.replace(/\\/g, '/');
    if (!normalizedSource.startsWith(normalizedRoot + '/')) {
      vscode.window.showErrorMessage('Source file must be inside the project folder.');
      return;
    }

    const sourceContent = await readFile(sourcePath, 'utf-8');
    const sourceStat = await stat(sourcePath);
    const sourceFilename = basename(sourcePath);
    const sourceExt = extname(sourcePath);
    const slug = sourceFilename.replace(/\.[^.]+$/, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const summaryRelPath = `sources/${slug}-summary.md`;
    const summaryFullPath = join(wikiDir, summaryRelPath);
    const relativeSourcePath = relative(root, resolve(sourcePath)).replace(/\\/g, '/');
    const today = new Date().toISOString().slice(0, 10);

    const excerpt = sourceContent.length > 500
      ? sourceContent.slice(0, 500) + '…'
      : sourceContent;

    await writePage(summaryFullPath, {
      frontmatter: {
        type: 'source',
        title: sourceFilename,
        source_path: relativeSourcePath,
        ingested: today,
        tags: [],
      },
      body: `# ${sourceFilename}\n\n**Source:** ${relativeSourcePath}  \n**Type:** ${sourceExt || 'unknown'}  \n**Size:** ${sourceStat.size} bytes  \n**Ingested:** ${today}\n\n## Content Preview\n\n${excerpt}`,
    });

    await addEntry(indexPath, {
      path: summaryRelPath,
      title: sourceFilename,
      summary: `Source file (${sourceExt || 'unknown'})`,
      category: 'Sources',
      tags: [],
    });

    await appendEntry(logPath, {
      verb: 'ingested',
      subject: sourceFilename,
      details: `Ingested source "${sourceFilename}" → ${summaryRelPath}`,
    });

    vscode.window.showInformationMessage(`Ingested: ${summaryRelPath}`);
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

    const entries = await readIndex(indexPath);
    const terms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return;

    const countOccurrences = (text: string, term: string): number => {
      const lower = text.toLowerCase();
      if (!term) return 0;
      let count = 0;
      let pos = 0;
      while ((pos = lower.indexOf(term, pos)) !== -1) {
        count++;
        pos += term.length;
      }
      return count;
    };

    interface ScoredResult {
      title: string;
      path: string;
      score: number;
      excerpt: string;
    }

    const results: ScoredResult[] = [];
    for (const entry of entries) {
      let score = 0;
      for (const term of terms) {
        score += countOccurrences(entry.title, term) * 3;
        score += countOccurrences(entry.summary, term) * 2;
      }
      if (score === 0) continue;

      let body = '';
      try {
        const page = await readPage(join(wikiDir, entry.path));
        body = page.body;
        for (const term of terms) {
          score += countOccurrences(body, term);
        }
      } catch {
        // Page file missing — use index score only
      }

      const cleaned = body.replace(/\s+/g, ' ').trim();
      const excerpt = cleaned.length > 200 ? cleaned.slice(0, 200) + '…' : cleaned;
      results.push({ title: entry.title, path: entry.path, score, excerpt });
    }

    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      vscode.window.showInformationMessage(`No results for "${queryStr}".`);
      return;
    }

    const items = results.map((r) => ({
      label: r.title,
      description: `Score: ${r.score}`,
      detail: r.excerpt,
      path: r.path,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} result(s) for "${queryStr}"`,
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

    const normalizePath = (p: string) => p.replace(/\\/g, '/');

    const allPages = await listPages(wikiDir);
    const wikiPages = allPages.filter((p) => {
      const rel = normalizePath(relative(wikiDir, p));
      return rel !== 'index.md' && rel !== 'log.md';
    });

    const existingPagePaths = new Set(wikiPages.map((p) => normalizePath(relative(wikiDir, p))));

    const pageLinksMap = new Map<string, string[]>();
    const inboundLinks = new Set<string>();

    for (const pagePath of wikiPages) {
      try {
        const page = await readPage(pagePath);
        const links = getPageLinks(page.body);
        const resolvedLinks: string[] = [];
        for (const link of links) {
          const resolved = resolve(pagePath, '..', link);
          const rel = normalizePath(relative(wikiDir, resolved));
          resolvedLinks.push(rel);
          inboundLinks.add(rel);
        }
        pageLinksMap.set(pagePath, resolvedLinks);
      } catch {
        // skip unreadable pages
      }
    }

    const indexEntries = await readIndex(indexPath);
    const indexedPaths = new Set(indexEntries.map((e) => normalizePath(e.path)));

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    // broken-links
    for (const [pagePath, links] of pageLinksMap) {
      for (const linkRel of links) {
        if (!existingPagePaths.has(linkRel)) errorCount++;
      }
    }
    // orphan-pages
    for (const pageRel of existingPagePaths) {
      if (!inboundLinks.has(pageRel) && !indexedPaths.has(pageRel)) warningCount++;
    }
    // index-completeness
    for (const pageRel of existingPagePaths) {
      if (!indexedPaths.has(pageRel)) warningCount++;
    }
    // stale-entries
    for (const entry of indexEntries) {
      const fullPath = join(wikiDir, normalizePath(entry.path));
      try {
        await access(fullPath, constants.F_OK);
      } catch {
        errorCount++;
      }
    }

    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} error(s)`);
    if (warningCount > 0) parts.push(`${warningCount} warning(s)`);

    if (parts.length === 0) {
      vscode.window.showInformationMessage('Lint: no issues found ✓');
    } else {
      const summary = parts.join(', ');
      if (errorCount > 0) {
        vscode.window.showWarningMessage(`Lint: ${summary}`);
      } else {
        vscode.window.showInformationMessage(`Lint: ${summary}`);
      }
    }
  });

  // ── llmwiki.status ───────────────────────────────────────────
  reg('llmwiki.status', async () => {
    let sourceCount = 0;
    try {
      const rawEntries = await readdir(rawDir, { withFileTypes: true, recursive: true });
      sourceCount = rawEntries.filter((e) => e.isFile()).length;
    } catch {
      // raw/ doesn't exist
    }

    const allPages = await listPages(wikiDir);
    const wikiPages = allPages.filter((p) => {
      const rel = relative(wikiDir, p).replace(/\\/g, '/');
      return rel !== 'index.md' && rel !== 'log.md';
    });
    const wikiPageCount = wikiPages.length;

    const logEntries = await readLog(logPath);
    const ingestEntries = logEntries.filter((e) => e.verb.toLowerCase().includes('ingest'));
    const lastIngestDate = ingestEntries.length > 0
      ? ingestEntries[ingestEntries.length - 1].date
      : null;

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

    const lines = [
      `Pages: ${wikiPageCount}`,
      `Sources: ${sourceCount}`,
      `Coverage: ${coveragePct}%`,
      `Last ingest: ${lastIngestDate ?? '—'}`,
      `Orphans: ${orphanPageCount}`,
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

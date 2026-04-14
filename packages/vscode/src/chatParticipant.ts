import * as vscode from 'vscode';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  queryWiki,
  readIndex,
  readPage,
  writePage,
  directoryExists,
  lintWiki,
  lintFix,
  deletePage,
  type IndexEntry,
} from '@llmwiki/shared';

const WIKI_DIR_NAME = '.wiki';

/**
 * Get the preferred LLM model — claude-opus-4.6 if available, otherwise the request's model.
 */
async function getModel(
  requestModel: vscode.LanguageModelChat,
  outputChannel: vscode.OutputChannel,
): Promise<vscode.LanguageModelChat> {
  try {
    const preferred = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
    if (preferred.length > 0) {
      outputChannel.appendLine(`[wiki chat] Using model: ${preferred[0].family}`);
      return preferred[0];
    }
  } catch {
    // fall through
  }
  outputChannel.appendLine(`[wiki chat] Using request model: ${requestModel.family}`);
  return requestModel;
}

/**
 * Register the @wiki chat participant.
 *
 * The participant answers questions from the compiled wiki.
 * Strategy-aligned: "the LLM reads the index first to find relevant pages,
 * then drills into them" — exactly what this does.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  workspaceFolder: string,
  outputChannel: vscode.OutputChannel,
): void {
  const wikiRoot = join(workspaceFolder, WIKI_DIR_NAME);
  const wikiDir = join(wikiRoot, 'wiki');
  const indexPath = join(wikiDir, 'index.md');

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => {
    // Check wiki exists
    if (!(await directoryExists(wikiDir))) {
      stream.markdown(
        'The wiki is not initialized yet. Run **LLM Wiki: Initialize Wiki** from the command palette first.',
      );
      return;
    }

    if (request.command === 'status') {
      return handleStatus(wikiRoot, stream);
    }

    if (request.command === 'lint') {
      return handleLint(request, wikiRoot, wikiDir, stream, token, outputChannel);
    }

    if (request.command === 'fix') {
      return handleFix(request, wikiRoot, wikiDir, stream, token, outputChannel);
    }

    if (request.command === 'save') {
      return handleSave(request, wikiRoot, stream, outputChannel);
    }

    // Default: answer a question from the wiki
    return handleQuery(
      request,
      chatContext,
      stream,
      token,
      wikiRoot,
      wikiDir,
      indexPath,
      outputChannel,
    );
  };

  const participant = vscode.chat.createChatParticipant('llmwiki.wiki', handler);
  participant.iconPath = new vscode.ThemeIcon('book');
  context.subscriptions.push(participant);
}

// ── /query (default) ─────────────────────────────────────────────

async function handleQuery(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  wikiRoot: string,
  wikiDir: string,
  indexPath: string,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const question = request.prompt.trim();
  if (!question) {
    stream.markdown('Ask me anything about your wiki knowledge base.');
    return;
  }

  stream.progress('Searching wiki…');

  // Step 1: Read the index for full context
  let entries: IndexEntry[] = [];
  try {
    entries = await readIndex(indexPath);
  } catch {
    // empty index
  }

  // Step 2: Keyword search for relevant pages
  const searchResult = await queryWiki(question, wikiRoot, false);
  const topResults = searchResult.results.slice(0, 8);

  // Step 3: Read the content of top-matching pages
  stream.progress('Reading relevant pages…');
  const pageContents: Array<{ title: string; path: string; content: string }> = [];
  for (const result of topResults) {
    try {
      const page = await readPage(join(wikiDir, result.path));
      pageContents.push({
        title: result.title,
        path: result.path,
        content: page.body.slice(0, 3000),
      });
    } catch {
      // skip unreadable pages
    }
  }

  // Step 4: Build the wiki context for the LLM
  const wikiIndex = entries
    .map((e) => `- [${e.title}](${e.path}) (${e.category}): ${e.summary}`)
    .join('\n');

  const relevantPages = pageContents.length > 0
    ? pageContents
        .map((p) => `### ${p.title} (${p.path})\n${p.content}`)
        .join('\n\n---\n\n')
    : 'No pages matched the query.';

  // Step 5: Build conversation history
  const previousMessages = chatContext.history.filter(
    (h): h is vscode.ChatResponseTurn => h instanceof vscode.ChatResponseTurn,
  );
  const messages: vscode.LanguageModelChatMessage[] = [];

  messages.push(
    vscode.LanguageModelChatMessage.User(
      `You are a knowledgeable assistant that answers questions using a personal wiki knowledge base. You have access to the wiki's index and relevant page content below.

Rules:
- Answer based on the wiki content. Cite specific pages by name when referencing information.
- If the wiki doesn't contain enough information to answer, say so honestly and suggest what sources could be added.
- Be concise but thorough. Use markdown formatting.
- If the answer reveals connections between pages, mention them — cross-referencing is a core value of this wiki.
- Good answers can become wiki pages themselves. If the user's question produces a valuable synthesis, suggest they save it with /save.

## Wiki Index
${wikiIndex || 'No pages in the index yet.'}

## Relevant Pages
${relevantPages}`,
    ),
  );

  // Add conversation history
  for (const turn of previousMessages) {
    let fullMessage = '';
    for (const part of turn.response) {
      if (part instanceof vscode.ChatResponseMarkdownPart) {
        fullMessage += part.value.value;
      }
    }
    if (fullMessage) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
    }
  }

  // Add previous user messages from history
  for (const turn of chatContext.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(question));

  // Step 6: Stream the LLM response
  stream.progress('Thinking…');

  try {
    const model = await getModel(request.model, outputChannel);
    const chatResponse = await model.sendRequest(messages, {}, token);
    for await (const fragment of chatResponse.text) {
      stream.markdown(fragment);
    }
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      outputChannel.appendLine(`[wiki chat] LLM error: ${err.message} (${err.code})`);
      stream.markdown(`Failed to get a response: ${err.message}`);
    } else {
      throw err;
    }
  }

  // Add references to cited pages
  if (pageContents.length > 0) {
    stream.markdown('\n\n---\n**Sources:**\n');
    for (const page of pageContents) {
      const uri = vscode.Uri.file(join(wikiDir, page.path));
      stream.anchor(uri, page.title);
      stream.markdown(' ');
    }
  }
}

// ── /status ──────────────────────────────────────────────────────

async function handleStatus(
  wikiRoot: string,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const { getWikiStatus } = await import('@llmwiki/shared');
  const status = await getWikiStatus(wikiRoot);

  stream.markdown(`## Wiki Status\n\n`);
  stream.markdown(`| Metric | Value |\n|--------|-------|\n`);
  stream.markdown(`| Pages | ${status.wiki_page_count} |\n`);
  stream.markdown(`| Sources | ${status.source_count} |\n`);
  stream.markdown(`| Coverage | ${status.index_coverage_pct}% |\n`);
  stream.markdown(`| Last ingest | ${status.last_ingest_date ?? '—'} |\n`);
  stream.markdown(`| Orphans | ${status.orphan_page_count} |\n`);
}

// ── /save ────────────────────────────────────────────────────────

async function handleSave(
  request: vscode.ChatRequest,
  wikiRoot: string,
  stream: vscode.ChatResponseStream,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  // Save the last assistant response as a wiki page
  // (requires user to provide a name)
  const name = request.prompt.trim();
  if (!name) {
    stream.markdown('Usage: `@wiki /save <page name>`\n\nProvide a name and the previous answer will be saved as a wiki concept page.');
    return;
  }

  stream.markdown(`To save this as a wiki page, use the **LLM Wiki: Ingest Source** command or create the page manually in the wiki.`);
  stream.markdown(`\n\nSuggested path: \`concepts/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md\``);
}

// ── /lint ────────────────────────────────────────────────────────

async function handleLint(
  request: vscode.ChatRequest,
  wikiRoot: string,
  wikiDir: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  stream.progress('Running wiki health checks…');

  const result = await lintWiki(wikiRoot);

  if (result.findings.length === 0) {
    stream.markdown('**Wiki health check passed** — no issues found.\n');
    return;
  }

  // Group findings for the LLM to interpret
  const findingsSummary = result.findings
    .map((f) => `- **${f.severity}** (${f.category}): ${f.message}${f.file ? ` — \`${f.file}\`` : ''}`)
    .join('\n');

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(
      `You are a wiki health advisor. Analyze the following lint findings from a personal knowledge base and provide:
1. A brief summary of the wiki's health
2. For each issue category, explain what it means and suggest specific fixes
3. Prioritize: which issues should be fixed first?
4. If any issues could be automatically fixed by re-ingesting sources, mention that

Be concise and actionable. Use markdown formatting.

## Lint Results
- Errors: ${result.errorCount}
- Warnings: ${result.warningCount}
- Info: ${result.findings.length - result.errorCount - result.warningCount}

## Findings
${findingsSummary}`,
    ),
  ];

  try {
    const model = await getModel(request.model, outputChannel);
    const chatResponse = await model.sendRequest(messages, {}, token);
    for await (const fragment of chatResponse.text) {
      stream.markdown(fragment);
    }
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      outputChannel.appendLine(`[wiki chat] LLM error: ${err.message} (${err.code})`);
    }
    // Fall back to raw findings if LLM fails
    stream.markdown(`## Wiki Lint Results\n\n`);
    stream.markdown(`**${result.errorCount}** errors, **${result.warningCount}** warnings\n\n`);
    stream.markdown(findingsSummary);
  }

  // Add file references for findings with associated files
  const filesReferenced = new Set<string>();
  for (const finding of result.findings) {
    if (finding.file && !filesReferenced.has(finding.file)) {
      filesReferenced.add(finding.file);
      const uri = vscode.Uri.file(join(wikiDir, finding.file));
      stream.reference(uri);
    }
  }
}

// ── /fix ─────────────────────────────────────────────────────────

async function handleFix(
  request: vscode.ChatRequest,
  wikiRoot: string,
  wikiDir: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  // Step 1: Clean orphaned entity/concept pages whose source is gone
  stream.progress('Cleaning orphaned pages…');
  let cleanedPages = 0;
  try {
    const { readdir, stat: fsStat } = await import('node:fs/promises');
    const { extname } = await import('node:path');
    const allFiles = await readdir(wikiDir, { recursive: true }) as string[];
    const mdPages = allFiles
      .filter((f) => typeof f === 'string' && extname(f) === '.md')
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f.startsWith('entities/') || f.startsWith('concepts/'));

    for (const relPath of mdPages) {
      try {
        const page = await readPage(join(wikiDir, relPath));
        const sources = page.frontmatter.sources as string[] | undefined;
        if (sources && sources.length > 0) {
          const allMissing = (await Promise.all(
            sources.map(async (s) => {
              try { await fsStat(join(wikiDir, s)); return false; }
              catch { return true; }
            }),
          )).every(Boolean);

          if (allMissing) {
            await deletePage(wikiDir, relPath);
            cleanedPages++;
            outputChannel.appendLine(`[fix] Cleaned orphaned page: ${relPath}`);
          }
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // readdir may fail
  }

  if (cleanedPages > 0) {
    stream.markdown(`**Cleaned ${cleanedPages} orphaned page(s)** whose source files were removed.\n\n`);
  }

  // Step 2: Run mechanical lint-fix
  stream.progress('Running auto-fix…');
  const fixResult = await lintFix(wikiRoot, { fixOrphans: true });

  if (fixResult.fixedCount > 0) {
    stream.markdown(`**Auto-fixed ${fixResult.fixedCount} issue(s):**\n`);
    for (const f of fixResult.fixed) {
      stream.markdown(`- ✓ (${f.category}) ${f.message}\n`);
    }
    stream.markdown('\n');
  }

  // Step 3: If remaining issues, use LLM to analyze and fix
  const remaining = fixResult.remaining;
  if (remaining.length === 0 && cleanedPages === 0 && fixResult.fixedCount === 0) {
    stream.markdown('**Wiki is healthy** — no issues found.\n');
    return;
  }

  if (remaining.length === 0) {
    stream.markdown('**All issues resolved.** ✓\n');
    return;
  }

  // Step 4: Ask LLM to fix remaining issues
  stream.progress('Analyzing remaining issues with LLM…');

  const findingsSummary = remaining
    .map((f) => `- **${f.severity}** (${f.category}): ${f.message}${f.file ? ` — \`${f.file}\`` : ''}`)
    .join('\n');

  // Read affected pages for context
  const affectedFiles = new Set<string>();
  for (const f of remaining) {
    if (f.file) affectedFiles.add(f.file);
  }

  let pagesContext = '';
  for (const relPath of affectedFiles) {
    try {
      const page = await readPage(join(wikiDir, relPath));
      pagesContext += `### ${relPath}\n\`\`\`yaml\n${JSON.stringify(page.frontmatter, null, 2)}\n\`\`\`\n${page.body.slice(0, 1000)}\n\n`;
    } catch {
      // skip
    }
  }

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(
      `You are a wiki maintenance bot. The automated lint-fix has already handled what it could. The following issues remain and need your help.

For each issue, provide a specific fix action. You can:
1. For **broken-links**: suggest removing the broken link or what the correct link target should be
2. For **orphan-pages**: suggest whether to delete the page or what pages should link to it
3. For other issues: explain the fix needed

Respond in this JSON format:
{
  "fixes": [
    {
      "file": "relative/path.md",
      "action": "remove-link" | "update-link" | "delete-page" | "skip",
      "details": "explanation",
      "old_text": "text to find (for link fixes)",
      "new_text": "replacement text (for link fixes)"
    }
  ],
  "summary": "brief summary of fixes applied"
}

Only output valid JSON. No markdown fences, no explanation outside the JSON.

## Remaining Issues
${findingsSummary}

## Affected Pages
${pagesContext}`,
    ),
  ];

  try {
    const model = await getModel(request.model, outputChannel);
    const chatResponse = await model.sendRequest(messages, {}, token);

    let fullResponse = '';
    for await (const chunk of chatResponse.text) {
      fullResponse += chunk;
    }

    // Parse and apply fixes
    let cleaned = fullResponse.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);
    let appliedFixes = 0;

    if (Array.isArray(parsed.fixes)) {
      for (const fix of parsed.fixes) {
        if (!fix.file || fix.action === 'skip') continue;

        try {
          if (fix.action === 'delete-page') {
            await deletePage(wikiDir, fix.file);
            appliedFixes++;
            stream.markdown(`- ✓ Deleted \`${fix.file}\`: ${fix.details}\n`);
          } else if ((fix.action === 'remove-link' || fix.action === 'update-link') && fix.old_text) {
            const page = await readPage(join(wikiDir, fix.file));
            const newBody = page.body.replace(fix.old_text, fix.new_text ?? '');
            if (newBody !== page.body) {
              page.body = newBody;
              await writePage(join(wikiDir, fix.file), page);
              appliedFixes++;
              stream.markdown(`- ✓ Fixed link in \`${fix.file}\`: ${fix.details}\n`);
            }
          }
        } catch (err) {
          stream.markdown(`- ✗ Failed to fix \`${fix.file}\`: ${err}\n`);
          outputChannel.appendLine(`[fix] Failed: ${fix.file} — ${err}`);
        }
      }
    }

    stream.markdown(`\n**${appliedFixes} LLM fix(es) applied.**`);
    if (parsed.summary) {
      stream.markdown(` ${parsed.summary}`);
    }
    stream.markdown('\n');
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      outputChannel.appendLine(`[fix] LLM error: ${err.message} (${err.code})`);
    } else {
      outputChannel.appendLine(`[fix] Error: ${err}`);
    }
    // Fall back to showing remaining issues
    stream.markdown(`\n**${remaining.length} issue(s) could not be auto-fixed:**\n${findingsSummary}\n`);
  }

  // Add references to affected files
  for (const relPath of affectedFiles) {
    try {
      const uri = vscode.Uri.file(join(wikiDir, relPath));
      stream.reference(uri);
    } catch {
      // skip
    }
  }
}

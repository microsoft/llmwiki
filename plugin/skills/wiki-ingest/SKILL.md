---
name: wiki-ingest
description: Ingest a source document (article, paper, notes, transcript) into the user's LLM Wiki and integrate it — summary page, entity and concept pages, crosslinks and a health check — with the LLM Wiki MCP tools. Use when the user wants to add, file, import or ingest a source into their wiki.
argument-hint: "[file path]"
---

# Ingest a source into the wiki

1. **Place the source.** Sources live in `.wiki/raw/` and are never modified there. If the user points at a file elsewhere, copy it into `.wiki/raw/` (keep the original where it is). In VS Code with the LLM Wiki extension, a file that appears in `.wiki/raw/` is also ingested by the extension automatically.
2. **Ingest.** Call `wiki_ingest_with_context` with `sourcePath` set to `raw/<file>`. It writes a summary page under `sources/` and returns `related_pages` and `suggested_actions`.
   - If it reports `skipped` because the source was already ingested (for example by the VS Code extension), don't force it. Read the existing summary page it returns as `summary_page`, check which entity and concept pages already exist, and only add what is missing in the steps below.
   - Re-ingesting with `force: true` overwrites the summary page; do it only if the user asks.
3. **Improve the summary.** Read the source and the summary page. If the summary is a thin stub, rewrite it with `wiki_update_page` (`bodyReplace`): key points, notable claims and numbers, open questions.
4. **Extract entities and concepts.** For each important person, organization or named thing, use `wiki_create_entity`; for each idea, technique or mechanism, use `wiki_create_concept`. Pass `sources` with the summary page path (for example `["sources/article-summary.md"]`) so the page is cleaned up if the source is removed later.
   - First check `related_pages` and `wiki_query`: if a page already exists, extend it with `wiki_update_page` (`bodyAppend`) and pass `addSources` with the summary page path instead. The create tools overwrite a page with the same name.
5. **Connect.** Use `wiki_add_crosslinks` to link the new pages to related existing pages, and the existing pages back to the new ones.
6. **Check health.** Run `wiki_lint` and fix anything this ingest introduced (for example broken links).
7. **Report** what was created, updated and linked.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

---
name: wiki-fix
description: Find and fix problems in the user's LLM Wiki — stale index entries, unindexed pages, missing frontmatter, broken links, orphaned pages — with the LLM Wiki MCP tools, asking before anything is deleted.
disable-model-invocation: true
---

# Fix wiki issues

1. **Preview.** Call `wiki_fix` with `dryRun: true` and summarize what it would change.
2. **Confirm deletions.** If `removed_pages` is not empty, list those pages (entity/concept pages whose raw sources were all removed) and ask the user whether to delete them. Wait for an explicit yes. If the user declines or doesn't answer, don't call `wiki_fix` without `dryRun`, because it would delete them. Run `wiki_lint` instead, and continue with step 4 using its findings.
3. **Apply.** Call `wiki_fix` without `dryRun`, only if the preview listed no pages to delete or the user approved deleting them.
4. **Resolve what remains.** Work through the findings that still need judgment:
   - `broken-links` / `missing-pages`: read the page with `wiki_read_page`, find the intended target with `wiki_query`, then fix the link with `wiki_update_page` (`bodyReplace` with the corrected body), or remove the link. Create a missing page only if the user wants it.
   - `frontmatter-validation` (invalid type): set a valid type (entity, concept, source, summary or query) with `wiki_update_page`.
   - `orphan-pages`: link the page from related pages with `wiki_add_crosslinks`.
5. **Never delete without confirmation.** Use `wiki_delete_page` only after the user explicitly agrees, then fix the links it reports in `linkedFrom`.
6. **Verify.** Run `wiki_lint` and report what was fixed and what still needs the user's decision.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

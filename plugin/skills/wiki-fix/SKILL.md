---
name: wiki-fix
description: Find and fix problems in the user's LLM Wiki — stale index entries, unindexed pages, missing frontmatter, broken links, orphaned pages — with the LLM Wiki MCP tools, asking before anything is deleted.
disable-model-invocation: true
---

# Fix wiki issues

1. **Preview.** Call `wiki_fix` with `dryRun: true`. Summarize what it would change, and call out any pages it would delete (entity/concept pages whose raw sources were removed).
2. **Apply.** Call `wiki_fix` without `dryRun`.
3. **Resolve what remains.** Work through the `remaining` findings:
   - `broken-links` / `missing-pages`: read the page with `wiki_read_page`, find the intended target with `wiki_query`, then fix the link with `wiki_update_page` (`bodyReplace` with the corrected body), or remove the link. Create a missing page only if the user wants it.
   - `frontmatter-validation` (invalid type): set a valid type (entity, concept, source, summary or query) with `wiki_update_page`.
   - `orphan-pages`: link the page from related pages with `wiki_add_crosslinks`.
4. **Never delete without confirmation.** Use `wiki_delete_page` only after the user explicitly agrees, then fix the links it reports in `linkedFrom`.
5. **Verify.** Run `wiki_lint` and report what was fixed and what still needs the user's decision.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

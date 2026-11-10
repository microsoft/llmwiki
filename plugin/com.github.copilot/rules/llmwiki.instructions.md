---
name: LLM Wiki conventions
description: Conventions for reading and editing an LLM Wiki in .wiki/
applyTo: ".wiki/**"
---

- `.wiki/` is an LLM Wiki. Its schema and conventions are in `.wiki/AGENTS.md`; follow them.
- Never modify files in `.wiki/raw/`. They are the user's sources.
- Prefer the LLM Wiki MCP tools (`wiki_write_page`, `wiki_update_page`, `wiki_create_entity`, `wiki_create_concept`, `wiki_add_crosslinks`, `wiki_delete_page`) over editing files in `.wiki/wiki/` directly, so `wiki/index.md` and `wiki/log.md` stay consistent.
- If you do edit a page directly, keep its frontmatter (`type`, `title`, `tags`) valid and run `wiki_lint` afterwards.
- Link pages with relative markdown links that end in `.md`.

---
name: wiki-ask
description: Answer a question from the user's LLM Wiki knowledge base (.wiki/) by searching and reading wiki pages with the LLM Wiki MCP tools, and cite the pages used. Use when the user asks about people, ideas, sources or topics collected in their wiki, or asks to "ask the wiki".
argument-hint: "[question]"
---

# Ask the wiki

Answer the user's question from their LLM Wiki, not from general knowledge.

1. Search with `wiki_query` using the key terms of the question. If nothing relevant comes back, try synonyms, or scan the catalog with `wiki_read_index`.
2. Read the most relevant pages (usually 3–8) with `wiki_read_page`. Follow links to closely related pages when they add needed context.
3. Answer from what the pages say. Cite every page you rely on as a link to its file, for example `[Attention](.wiki/wiki/concepts/attention.md)`. Point out connections and contradictions between pages.
4. If the wiki doesn't answer the question, say so plainly and suggest sources the user could add to `.wiki/raw/`.
5. If the answer is a useful synthesis, offer to save it to the wiki with the `wiki-save` skill.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

---
name: wiki-research
description: Research a topic across the user's LLM Wiki — gather every relevant page, synthesize what the wiki knows, flag contradictions, and list knowledge gaps with suggested new pages. Use when the user wants an overview, literature-style synthesis or gap analysis of a topic in their wiki.
argument-hint: "[topic]"
---

# Research a topic in the wiki

1. Search with `wiki_query` for the topic and for its main sub-topics and synonyms. Use `wiki_read_index` to spot pages whose titles or summaries match.
2. Read the 5–10 most relevant pages with `wiki_read_page`, plus pages they link to that are clearly on topic.
3. Write a synthesis:
   - what the wiki says about the topic, organized by theme rather than by page;
   - where pages agree, add complementary detail, or contradict each other;
   - a link to each page you used, for example `[Transformers](.wiki/wiki/concepts/transformers.md)`.
4. List knowledge gaps, most important first:
   - sub-topics that are mentioned but have no page;
   - related topics the wiki doesn't cover yet;
   - pages that are thin and should be enriched;
   - sources the user could add to `.wiki/raw/` to close the gaps.
5. Offer to save the synthesis with the `wiki-save` skill, or to create the missing pages.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

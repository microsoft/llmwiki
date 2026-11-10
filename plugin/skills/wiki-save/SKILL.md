---
name: wiki-save
description: Save an answer or synthesis from this conversation as a page in the user's LLM Wiki, linked to the wiki pages it draws on.
argument-hint: "[page title]"
disable-model-invocation: true
---

# Save to the wiki

1. **Pick the content.** Use the previous answer in this conversation, unless the user supplied the text to save. Don't add new claims.
2. **Pick the title.** Use the argument if one was given; otherwise a short descriptive title. The slug is the title in lowercase words joined by hyphens.
3. **Avoid duplicates.** Search with `wiki_query`. If a page on the same topic exists, ask whether to extend it with `wiki_update_page` (`bodyAppend`) instead of creating a new page.
4. **Save.** Call `wiki_write_page` with `pagePath` `queries/<slug>.md`, `type` `query`, the title, a few tags, and the content as `body`. Write links to wiki pages relative to the new page, for example `[Attention](../concepts/attention.md)`.
5. **Link.** Use `wiki_add_crosslinks` from the new page to the pages it cites.
6. **Confirm** the saved path to the user.

If a tool reports that no wiki is open, call `wiki_open` with the absolute path of the current workspace folder, then retry.

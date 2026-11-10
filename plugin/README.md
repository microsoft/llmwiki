# LLM Wiki agent plugin

An [Agent Plugins](https://agent-plugins.org) package for [LLM Wiki](https://github.com/microsoft/llmwiki), a personal knowledge base that your agent maintains as interlinked markdown in `.wiki/`.

It works in GitHub Copilot CLI, the GitHub Copilot app, VS Code, and other Agent Plugins clients. In VS Code, prefer the [LLM Wiki extension](../packages/vscode), which contributes the same skills and agent and adds tree views and commands.

## Contents

| Component | Path | Purpose |
|-----------|------|---------|
| Skills | `skills/` | `wiki-ask`, `wiki-research`, `wiki-ingest` (also loaded automatically), and `wiki-save`, `wiki-fix` (run on request) |
| MCP server | `mcp.json`, `server/llmwiki-mcp.cjs` | The LLM Wiki tools, resources and prompts. Needs Node.js 20+ on `PATH`. |
| Agent | `com.github.copilot/agents/wiki-librarian.agent.md` | The Wiki Librarian custom agent |
| Rule | `com.github.copilot/rules/llmwiki.instructions.md` | Conventions for files under `.wiki/` |

## Install

```bash
copilot plugin install microsoft/llmwiki:plugin
```

Or add this repository as a marketplace and install from it:

```bash
copilot plugin marketplace add microsoft/llmwiki
copilot plugin install llmwiki@llmwiki
```

Skills from a plugin are prefixed with its name, for example `/llmwiki:wiki-ask What do my notes say about attention?`.

## Using it

The MCP server starts in the plugin folder, so it has to find your wiki first. It checks the client's workspace roots; when the client doesn't report any, the skills tell the agent to call `wiki_open` with your project folder. To create a wiki, ask the agent to run `wiki_init` for the project folder, or use **LLM Wiki: Initialize Wiki** in VS Code.

## Development

The skills, agent and rule are the single source for both this plugin and the VS Code extension, which copies them at build time. `server/llmwiki-mcp.cjs` is generated: run `npm run build` at the repository root and commit the result. CI fails when it is out of date.

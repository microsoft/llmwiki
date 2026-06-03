# @llmwiki/core

Core wiki operations and Model Context Protocol (MCP) server for [LLM Wiki](https://github.com/microsoft/llmwiki).

This package powers the [`llmwiki` VS Code extension](https://github.com/microsoft/llmwiki/tree/main/packages/vscode) and ships a stdio MCP launcher so any MCP-compatible client (Claude Desktop, Cursor, custom agents) can read and write the same wiki.

## Install

```bash
npm install @llmwiki/core
```

## Use as a library

```ts
import {
  initWiki,
  ingestSource,
  queryWiki,
  lintWiki,
  createMcpServer,
} from '@llmwiki/core';
```

See the [main README](https://github.com/microsoft/llmwiki#readme) for the full API surface.

## Use as an MCP server

The package ships an `llmwiki-mcp` binary that exposes 14 wiki tools over stdio.

```bash
# Direct invocation
npx llmwiki-mcp ./.wiki

# Or from any MCP client config (Claude Desktop, Cursor, .vscode/mcp.json):
{
  "command": "npx",
  "args": ["-y", "@llmwiki/core", "llmwiki-mcp", "./.wiki"]
}
```

The single positional argument is the path to a `.wiki/` directory; it defaults to `./.wiki` when omitted.

## License

MIT — see [LICENSE](https://github.com/microsoft/llmwiki/blob/main/LICENSE).

import { isAbsolute, join } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getWikiStatus } from '../status.js';
import { initWiki } from '../init.js';
import { WIKI_DIR_NAME } from '../constants.js';
import { requireString, optionalString } from './read-tools.js';
import type { ToolArgs, ToolDefinition } from './read-tools.js';
import type { WikiRootState } from './wiki-root.js';

/**
 * Tools for choosing or creating the wiki. Only exposed when the server is not
 * bound to a fixed wiki root (for example when it runs from an agent plugin).
 */
export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: 'wiki_open',
    title: 'Open wiki',
    description:
      `Select the LLM Wiki to work with. Pass the absolute path of the project folder that contains the ${WIKI_DIR_NAME} directory (usually the current working directory). Call this when another wiki tool reports that no wiki is open.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Absolute path of the project folder (or of its ${WIKI_DIR_NAME} directory)`,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'wiki_init',
    title: 'Initialize wiki',
    description:
      `Create a new LLM Wiki (${WIKI_DIR_NAME}/ with raw/, wiki/, index.md, log.md and AGENTS.md) in a project folder and open it. Does nothing if the folder already has a wiki.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path of the project folder. Defaults to the first workspace folder reported by the client.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function requireAbsolute(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`'path' must be an absolute path (got "${path}")`);
  }
  return path;
}

/** Resolve a workspace tool call to its result text. */
export async function handleWorkspaceToolCall(
  name: string,
  args: ToolArgs,
  state: WikiRootState,
  server: Server,
): Promise<string> {
  switch (name) {
    case 'wiki_open': {
      const wikiRoot = state.open(requireAbsolute(requireString(args, 'path')));
      const status = await getWikiStatus(wikiRoot);
      return JSON.stringify({
        status: 'opened',
        wiki_root: wikiRoot,
        wiki_page_count: status.wiki_page_count,
        source_count: status.source_count,
      });
    }

    case 'wiki_init': {
      const requested = optionalString(args, 'path');
      const target = requested
        ? requireAbsolute(requested)
        : (await state.workspaceFolders(server))[0];
      if (!target) {
        throw new Error(
          "Pass 'path': the absolute path of the project folder to create the wiki in (usually the current working directory).",
        );
      }
      const result = await initWiki(target);
      const wikiRoot = state.open(join(target, WIKI_DIR_NAME));
      return JSON.stringify({ ...result, wiki_root: wikiRoot });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

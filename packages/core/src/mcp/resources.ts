import { join, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listPages, readPage } from '../wiki.js';
import { readIndex } from '../index-ops.js';
import { listSources } from '../sources.js';
import { isNotFoundError } from '../errors.js';
import { assertWithinDir } from './read-tools.js';

// ---------------------------------------------------------------------------
// Resource registration
// ---------------------------------------------------------------------------

/**
 * Register MCP resources so agents can browse wiki content without tool calls.
 *
 * Static resources:
 *   - `resource://wiki/index`   — full wiki index as JSON
 *   - `resource://wiki/pages`   — list of all pages with frontmatter
 *   - `resource://wiki/sources` — list of raw source files with metadata
 *
 * Template resources:
 *   - `resource://wiki/pages/{path}`   — single page content + frontmatter
 *   - `resource://wiki/sources/{path}` — raw source file content
 */
export function registerResources(server: Server, wikiRoot: string): void {
  const wikiDir = join(wikiRoot, 'wiki');
  const rawDir = join(wikiRoot, 'raw');
  const indexPath = join(wikiDir, 'index.md');

  // -----------------------------------------------------------------
  // List static resources
  // -----------------------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'resource://wiki/index',
        name: 'Wiki Index',
        description:
          'Complete wiki index as JSON with all entries, titles, summaries, categories, and tags',
        mimeType: 'application/json',
      },
      {
        uri: 'resource://wiki/pages',
        name: 'Wiki Pages',
        description:
          'List of all wiki pages with their relative paths and frontmatter metadata',
        mimeType: 'application/json',
      },
      {
        uri: 'resource://wiki/sources',
        name: 'Wiki Sources',
        description:
          'List of all raw source files with name, path, size, modified date, and extension',
        mimeType: 'application/json',
      },
    ],
  }));

  // -----------------------------------------------------------------
  // List resource templates (parameterised URIs)
  // -----------------------------------------------------------------
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: 'resource://wiki/pages/{path}',
        name: 'Wiki Page',
        description:
          'Read a single wiki page by relative path. Returns frontmatter and body content as JSON.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'resource://wiki/sources/{path}',
        name: 'Source File',
        description:
          'Read a raw source file by relative path. Returns the file content as plain text.',
        mimeType: 'text/plain',
      },
    ],
  }));

  // -----------------------------------------------------------------
  // Read a resource by URI
  // -----------------------------------------------------------------
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // --- Static: wiki index -------------------------------------------
    if (uri === 'resource://wiki/index') {
      const entries = await readIndex(indexPath);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(entries, null, 2),
          },
        ],
      };
    }

    // --- Static: wiki pages list --------------------------------------
    if (uri === 'resource://wiki/pages') {
      const fullPaths = await listPages(wikiDir);
      const pages = await Promise.all(
        fullPaths.map(async (p) => {
          const relPath = relative(wikiDir, p).replace(/\\/g, '/');
          try {
            const page = await readPage(p);
            return { path: relPath, frontmatter: page.frontmatter };
          } catch (err) {
            if (!isNotFoundError(err)) throw err;
            return { path: relPath, frontmatter: {} };
          }
        }),
      );
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(pages, null, 2),
          },
        ],
      };
    }

    // --- Static: sources list -----------------------------------------
    if (uri === 'resource://wiki/sources') {
      const sources = await listSources(rawDir);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(sources, null, 2),
          },
        ],
      };
    }

    // --- Template: single wiki page -----------------------------------
    const pageMatch = uri.match(/^resource:\/\/wiki\/pages\/(.+)$/);
    if (pageMatch) {
      const relPath = decodeURIComponent(pageMatch[1]);
      const fullPath = assertWithinDir(wikiDir, relPath);
      const page = await readPage(fullPath);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    }

    // --- Template: single source file ---------------------------------
    const sourceMatch = uri.match(/^resource:\/\/wiki\/sources\/(.+)$/);
    if (sourceMatch) {
      const relPath = decodeURIComponent(sourceMatch[1]);
      const fullPath = assertWithinDir(rawDir, relPath);
      const content = await readFile(fullPath, 'utf-8');
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: content,
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });
}

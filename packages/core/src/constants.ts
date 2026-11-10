/**
 * API version included in all JSON responses.
 * Increment on breaking schema changes.
 */
export const API_VERSION = '1';

/**
 * Name of the wiki root directory created inside the project folder.
 * All wiki data (raw/, wiki/, AGENTS.md) lives under this directory.
 */
export const WIKI_DIR_NAME = '.wiki';

/**
 * Version of the `@llmwiki/core` package, reported by the MCP server.
 * A unit test keeps it in sync with `packages/core/package.json`.
 */
export const CORE_VERSION = '0.1.2';

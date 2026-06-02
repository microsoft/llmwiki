import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appendEntry } from './log.js';
import { API_VERSION, WIKI_DIR_NAME } from './constants.js';
import { isNotFoundError } from './errors.js';

/**
 * Result of running the init command.
 */
export interface InitResult {
  command: string;
  api_version: string;
  status: 'created' | 'already_initialized';
  created_dirs: string[];
  created_files: string[];
  warning?: string;
}

/** Directories created by init, relative to root. */
const DIRS = [
  'raw',
  'wiki',
  'wiki/entities',
  'wiki/concepts',
  'wiki/sources',
] as const;

/** The starter wiki/index.md with empty category sections. */
const INDEX_CONTENT = `# Wiki Index

## Entities

## Concepts

## Sources
`;

/** AGENTS.md starter schema template. */
const AGENTS_CONTENT = `# AGENTS.md

## Wiki Schema

### Page Types

- **entity** — A person, place, organization, or thing
- **concept** — An idea, theory, or abstract topic
- **source** — A reference to raw material
- **summary** — An auto-generated summary of an ingested source
- **query** — A saved query result page

### Directory Structure

- \`raw/\` — Raw ingested documents
- \`wiki/\` — Processed wiki pages
  - \`wiki/entities/\` — Entity pages
  - \`wiki/concepts/\` — Concept pages
  - \`wiki/sources/\` — Source reference pages
  - \`wiki/index.md\` — Master index
  - \`wiki/log.md\` — Change log

### Frontmatter Schema

**Required fields:**
- \`type\` — Page type (entity, concept, source, summary, query)
- \`title\` — Page title

**Optional fields:**
- \`tags\` — Array of tag strings
- \`sources\` — Array of source references
- \`created\` — Creation date (YYYY-MM-DD)
- \`updated\` — Last updated date (YYYY-MM-DD)
- \`source_path\` — Relative path to the original source file
- \`ingested\` — Date the source was ingested

\`\`\`yaml
type: entity | concept | source | summary | query
title: string
tags: string[]
sources: string[]
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_path: string       # source/summary pages only
ingested: YYYY-MM-DD      # source/summary pages only
query: string             # query pages only — the original query string
results_count: number     # query pages only — number of results
\`\`\`

### Query Page Frontmatter

Query pages use the following frontmatter:

\`\`\`yaml
type: query
title: "<the query string>"
tags:
  - <derived from query terms>
created: YYYY-MM-DD
query: "<the original query string>"
results_count: <number of results>
\`\`\`

### Naming Conventions

- Filenames are lowercased
- Extensions are stripped
- Non-alphanumeric characters become hyphens
- Leading/trailing hyphens are removed
- Example: \`My Report (2024).pdf\` → \`my-report-2024\`
- Summary pages: \`sources/{slug}-summary.md\`
- Entity pages: \`entities/{slug}.md\`
- Concept pages: \`concepts/{slug}.md\`

### Ingest Workflow

1. Place a raw file in the \`raw/\` directory (or run **LLM Wiki: Add Source** from the Command Palette).
2. The extension automatically ingests new sources and writes a summary page in \`wiki/sources/\`.
3. \`wiki/index.md\` is updated with the new entry.
4. \`wiki/log.md\` records the ingestion event.

### Lint Rules

- **broken-links** (error) — Links pointing to non-existent files
- **orphan-pages** (warning) — Pages with no inbound links and not in index
- **index-completeness** (warning) — Pages not listed in wiki/index.md
- **stale-entries** (error) — Index entries pointing to deleted files
- **missing-pages** (info) — Referenced pages that do not exist yet

Run lint via the **LLM Wiki** chat participant: \`@wiki /lint\`.

### Cross-Referencing Guidelines

- Use standard Markdown links: \`[Title](relative/path.md)\`
- Links must be relative paths ending in \`.md\`
- External URLs (http/https) are ignored by lint
- Use relative paths from the current file location
- The lint command detects broken links and orphan pages
`;

/**
 * Initialize a wiki knowledge base at the given path.
 * Creates the `.wiki` directory containing the wiki structure.
 * The `targetPath` is the project/workspace folder; the wiki root
 * will be `targetPath/.wiki/`.
 *
 * Returns a structured result describing what was created.
 */
export async function initWiki(targetPath: string): Promise<InitResult> {
  const root = resolve(targetPath, WIKI_DIR_NAME);
  const wikiDir = join(root, 'wiki');

  // Detect if already initialized
  try {
    const wikiStat = await stat(wikiDir);
    if (wikiStat.isDirectory()) {
      return {
        command: 'init',
        api_version: API_VERSION,
        status: 'already_initialized',
        created_dirs: [],
        created_files: [],
        warning: 'Wiki is already initialized (wiki/ directory exists)',
      };
    }
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Directory does not exist — proceed with init
  }

  // Create directory structure
  for (const dir of DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }

  // Create wiki/index.md with category sections
  const indexPath = join(root, 'wiki', 'index.md');
  await writeFile(indexPath, INDEX_CONTENT, 'utf-8');

  // Create wiki/log.md with initialization entry
  const logPath = join(root, 'wiki', 'log.md');
  await appendEntry(logPath, {
    verb: 'initialized',
    subject: 'wiki',
    details: 'Wiki knowledge base initialized.',
  });

  // Create AGENTS.md with starter schema
  const agentsPath = join(root, 'AGENTS.md');
  await writeFile(agentsPath, AGENTS_CONTENT, 'utf-8');

  const createdFiles = ['wiki/index.md', 'wiki/log.md', 'AGENTS.md'];

  return {
    command: 'init',
    api_version: API_VERSION,
    status: 'created',
    created_dirs: [...DIRS],
    created_files: createdFiles,
  };
}

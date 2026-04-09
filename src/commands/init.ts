import { Command } from 'commander';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appendEntry } from '../lib/log.js';

/**
 * Result of running the init command.
 */
export interface InitResult {
  command: string;
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
- \`type\` — Page type (entity, concept, source, summary)
- \`title\` — Page title

**Optional fields:**
- \`tags\` — Array of tag strings
- \`sources\` — Array of source references
- \`created\` — Creation date (YYYY-MM-DD)
- \`updated\` — Last updated date (YYYY-MM-DD)
- \`source_path\` — Relative path to the original source file
- \`ingested\` — Date the source was ingested

\`\`\`yaml
type: entity | concept | source | summary
title: string
tags: string[]
sources: string[]
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_path: string   # source/summary pages only
ingested: YYYY-MM-DD  # source/summary pages only
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

1. Place raw file in \`raw/\` directory
2. Run \`plaid wiki ingest <source>\` (supports \`--dry-run\`)
3. A summary page is created in \`wiki/sources/\`
4. \`wiki/index.md\` is updated with the new entry
5. \`wiki/log.md\` records the ingestion event

### Lint Rules

- **broken-links** (error) — Links pointing to non-existent files
- **orphan-pages** (warning) — Pages with no inbound links and not in index
- **index-completeness** (warning) — Pages not listed in wiki/index.md
- **stale-entries** (error) — Index entries pointing to deleted files
- **missing-pages** (info) — Referenced pages that do not exist yet

Run lint: \`plaid wiki lint\` (supports \`--category\` filter)

### Cross-Referencing Guidelines

- Use standard Markdown links: \`[Title](relative/path.md)\`
- Links must be relative paths ending in \`.md\`
- External URLs (http/https) are ignored by lint
- Use relative paths from the current file location
- The lint command detects broken links and orphan pages
`;

/**
 * Initialize a wiki knowledge base at the given path.
 * Creates the directory structure, index, log, and AGENTS.md.
 * Returns a structured result describing what was created.
 */
export async function initWiki(targetPath: string): Promise<InitResult> {
  const root = resolve(targetPath);
  const wikiDir = join(root, 'wiki');

  // Detect if already initialized
  try {
    const wikiStat = await stat(wikiDir);
    if (wikiStat.isDirectory()) {
      return {
        command: 'init',
        status: 'already_initialized',
        created_dirs: [],
        created_files: [],
        warning: 'Wiki is already initialized (wiki/ directory exists)',
      };
    }
  } catch {
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
    status: 'created',
    created_dirs: [...DIRS],
    created_files: createdFiles,
  };
}

/**
 * Register the `init` subcommand on the wiki command group.
 */
export function registerInitCommand(wiki: Command): void {
  wiki
    .command('init')
    .description('Initialize a new wiki knowledge base')
    .option('--path <dir>', 'Target directory', '.')
    .action(async (options: { path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await initWiki(options.path);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.status === 'already_initialized') {
        console.log(`⚠ ${result.warning}`);
      } else {
        console.log('✓ Wiki initialized successfully');
        console.log(`  Directories: ${result.created_dirs.join(', ')}`);
        console.log(`  Files: ${result.created_files.join(', ')}`);
      }
    });
}

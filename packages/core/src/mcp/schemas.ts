/**
 * JSON Schemas for the structured results of tools that declare an
 * `outputSchema`. Each mirrors the corresponding TypeScript result type.
 */

const LINT_FINDING_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    category: { type: 'string' },
    message: { type: 'string' },
    file: { type: 'string' },
  },
  required: ['severity', 'category', 'message'],
};

/** Mirrors `StatusResult`. */
export const STATUS_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    api_version: { type: 'string' },
    source_count: { type: 'integer' },
    wiki_page_count: { type: 'integer' },
    last_ingest_date: { type: ['string', 'null'] },
    last_lint_date: { type: ['string', 'null'] },
    orphan_page_count: { type: 'integer' },
    index_coverage_pct: { type: 'number' },
  },
  required: [
    'source_count',
    'wiki_page_count',
    'last_ingest_date',
    'last_lint_date',
    'orphan_page_count',
    'index_coverage_pct',
  ],
};

/** Mirrors `LintResult`. */
export const LINT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    api_version: { type: 'string' },
    findings: { type: 'array', items: LINT_FINDING_SCHEMA },
    errorCount: { type: 'integer' },
    warningCount: { type: 'integer' },
    infoCount: { type: 'integer' },
    categorySummary: { type: 'object', additionalProperties: { type: 'integer' } },
  },
  required: ['findings', 'errorCount', 'warningCount', 'infoCount', 'categorySummary'],
};

/** Mirrors `QueryOutput`. */
export const QUERY_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    api_version: { type: 'string' },
    query: { type: 'string' },
    matches: { type: 'integer' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          path: { type: 'string' },
          score: { type: 'number' },
          excerpt: { type: 'string' },
        },
        required: ['title', 'path', 'score', 'excerpt'],
      },
    },
    saved: { type: 'string' },
  },
  required: ['query', 'matches', 'results'],
};

/** Mirrors `FixWikiResult`. */
export const FIX_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    api_version: { type: 'string' },
    dry_run: { type: 'boolean' },
    removed_pages: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: LINT_FINDING_SCHEMA },
    remaining: { type: 'array', items: LINT_FINDING_SCHEMA },
    fixedCount: { type: 'integer' },
    remainingCount: { type: 'integer' },
  },
  required: ['dry_run', 'removed_pages', 'fixed', 'remaining', 'fixedCount', 'remainingCount'],
};

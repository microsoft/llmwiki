import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Prompt definitions
// ---------------------------------------------------------------------------

export const PROMPTS = [
  {
    name: 'ingest-and-integrate',
    description:
      'Ingest a source file and integrate its knowledge into the wiki — create entities, concepts, crosslinks, and verify health.',
    arguments: [
      {
        name: 'source_path',
        description: 'Path to source file in the raw/ directory',
        required: true,
      },
    ],
  },
  {
    name: 'lint-and-fix',
    description:
      'Run wiki lint, review findings by severity, fix deterministic issues, and report remaining problems that need human judgment.',
  },
  {
    name: 'research-topic',
    description:
      'Research a topic across the wiki — query, read related pages, synthesize findings, and identify knowledge gaps.',
    arguments: [
      {
        name: 'topic',
        description: 'The topic to research across the wiki',
        required: true,
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Prompt message builders
// ---------------------------------------------------------------------------

function ingestAndIntegrateMessages(sourcePath: string) {
  return {
    description: `Ingest ${sourcePath} and integrate its knowledge into the wiki.`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `Ingest the source file "${sourcePath}" and fully integrate its knowledge into the wiki. Follow these steps:`,
            '',
            '1. **Ingest with context**: Call wiki_ingest_with_context with source_path set to',
            `   "${sourcePath}". Review the returned related_pages and suggested_actions.`,
            '',
            '2. **Create entity pages**: For each person, organization, or named thing mentioned',
            '   in the source, call wiki_create_entity with a descriptive title, summary, and',
            '   relevant tags. Skip entities that already exist in related_pages.',
            '',
            '3. **Create concept pages**: For each idea, technique, or mechanism described in',
            '   the source, call wiki_create_concept with a clear title, summary, and tags.',
            '   Skip concepts that already exist.',
            '',
            '4. **Add crosslinks**: Call wiki_add_crosslinks for each new page to connect it',
            '   to related existing pages. Also update existing pages to link back to new ones.',
            '',
            '5. **Verify wiki health**: Call wiki_lint and review the findings. Fix any errors',
            '   introduced during this workflow (missing index entries, broken links).',
            '',
            'Report a summary of what was created, linked, and any remaining lint findings.',
          ].join('\n'),
        },
      },
    ],
  };
}

function lintAndFixMessages() {
  return {
    description: 'Run wiki lint, fix deterministic issues, and report remaining findings.',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Audit the wiki for quality issues and fix what you can. Follow these steps:',
            '',
            '1. **Run lint**: Call wiki_lint to get all findings. Note the total count and',
            '   severity breakdown (error, warning, info).',
            '',
            '2. **Review errors first**: For each error-severity finding, determine if it can',
            '   be fixed deterministically:',
            '   - Stale index entries (page referenced in index but file missing) → remove entry',
            '   - Missing index entries (page exists but not in index) → add entry',
            '   - Missing frontmatter fields (no title, no tags) → add sensible defaults',
            '',
            '3. **Fix deterministic issues**: Use wiki_update_index to fix index problems.',
            '   Use wiki_read_page and appropriate write tools to fix frontmatter issues.',
            '',
            '4. **Report remaining**: List any findings that require human judgment:',
            '   - Orphan pages (exist but nothing links to them)',
            '   - Broken crosslinks (link target does not exist)',
            '   - Contradictory information across pages',
            '',
            'Summarize: how many issues found, how many fixed, how many remain.',
          ].join('\n'),
        },
      },
    ],
  };
}

function researchTopicMessages(topic: string) {
  return {
    description: `Research "${topic}" across the wiki and synthesize findings.`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `Research the topic "${topic}" across the wiki. Follow these steps:`,
            '',
            '1. **Query the wiki**: Call wiki_query with the topic to find relevant pages.',
            '   Note the number of results and their relevance.',
            '',
            '2. **Read key pages**: For each highly relevant result, call wiki_read_page to',
            '   read the full content. Focus on the top 5-10 most relevant pages.',
            '',
            '3. **Synthesize findings**: Combine information across pages into a coherent',
            '   summary. Note where pages agree, where they add complementary detail, and',
            '   where they might contradict each other.',
            '',
            '4. **Identify knowledge gaps**: Based on your synthesis, identify:',
            '   - Sub-topics that are mentioned but have no dedicated page',
            '   - Related topics that the wiki doesn\'t cover yet',
            '   - Pages that could be enriched with more detail',
            '',
            `Report your synthesis of "${topic}" and a prioritized list of suggested`,
            'wiki improvements (new pages to create, existing pages to enrich).',
          ].join('\n'),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register MCP prompts for reusable agent workflow templates.
 *
 * Prompts provide structured multi-step instructions that guide an LLM agent
 * through common wiki operations using the available MCP tools.
 */
export function registerPrompts(server: Server, _wikiRoot: string): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: 'arguments' in p ? [...p.arguments] : undefined,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'ingest-and-integrate': {
        const sourcePath = args?.source_path;
        if (!sourcePath) {
          throw new Error('Missing required argument: source_path');
        }
        return ingestAndIntegrateMessages(sourcePath);
      }

      case 'lint-and-fix':
        return lintAndFixMessages();

      case 'research-topic': {
        const topic = args?.topic;
        if (!topic) {
          throw new Error('Missing required argument: topic');
        }
        return researchTopicMessages(topic);
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });
}

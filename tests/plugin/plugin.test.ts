/**
 * Validates the agent plugin (plugin/), its marketplace entry, and that the
 * VS Code extension contributes the same skills, agent and instructions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { READ_TOOLS } from '../../packages/core/src/mcp/read-tools.js';
import { WRITE_TOOLS } from '../../packages/core/src/mcp/write-tools.js';
import { WORKSPACE_TOOLS } from '../../packages/core/src/mcp/workspace-tools.js';
import { PROMPTS } from '../../packages/core/src/mcp/prompts.js';
import { BASE_INSTRUCTIONS, buildInstructions } from '../../packages/core/src/mcp/instructions.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../packages/core/src/mcp/server.js';

const REPO = join(__dirname, '../..');
const PLUGIN = join(REPO, 'plugin');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

const pluginJson = readJson(join(PLUGIN, 'plugin.json'));
const mcpJson = readJson(join(PLUGIN, 'mcp.json'));
const marketplace = readJson(join(REPO, '.github', 'plugin', 'marketplace.json'));
const extensionPkg = readJson(join(REPO, 'packages', 'vscode', 'package.json'));

const skillNames = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const skills = skillNames.map((name) => ({
  name,
  ...matter(readFileSync(join(PLUGIN, 'skills', name, 'SKILL.md'), 'utf-8')),
}));
const agentFiles = readdirSync(join(PLUGIN, 'com.github.copilot', 'agents'));
const ruleFiles = readdirSync(join(PLUGIN, 'com.github.copilot', 'rules'));

const TOOL_NAMES = new Set([...READ_TOOLS, ...WRITE_TOOLS, ...WORKSPACE_TOOLS].map((t) => t.name));

describe('plugin manifest', () => {
  it('declares the Agent Plugins 1.0 schema and a valid name', () => {
    expect(pluginJson.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(pluginJson.name).toMatch(/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/);
    expect(pluginJson.name).not.toMatch(/--|\.\./);
  });

  it('keeps the plugin, marketplace and extension versions in sync', () => {
    expect(pluginJson.version).toBe(extensionPkg.version);
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === pluginJson.name);
    expect(entry?.version).toBe(pluginJson.version);
    expect(marketplace.metadata.version).toBe(pluginJson.version);
  });

  it('has a marketplace entry that points at the plugin folder', () => {
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === pluginJson.name);
    expect(entry).toBeDefined();
    expect(existsSync(join(REPO, entry.source, 'plugin.json'))).toBe(true);
    expect(marketplace.owner.name).toBeTruthy();
  });

  it('starts the bundled MCP server from the plugin root', () => {
    expect(mcpJson.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
    expect(Object.keys(mcpJson)).toEqual(['$schema', 'mcpServers']);
    const server = mcpJson.mcpServers.llmwiki;
    expect(server).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['${PLUGIN_ROOT}/server/llmwiki-mcp.cjs'],
    });
    expect(existsSync(join(PLUGIN, 'server', 'llmwiki-mcp.cjs'))).toBe(true);
  });
});

describe('skills', () => {
  it('ships the expected skills', () => {
    expect(skillNames).toEqual(['wiki-ask', 'wiki-fix', 'wiki-ingest', 'wiki-research', 'wiki-save']);
  });

  it.each(skillNames)('%s has valid SKILL.md frontmatter', (name) => {
    const skill = skills.find((s) => s.name === name)!;
    expect(skill.data.name).toBe(name);
    expect(skill.data.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(typeof skill.data.description).toBe('string');
    expect(skill.data.description.length).toBeGreaterThan(20);
    expect(skill.data.description.length).toBeLessThanOrEqual(1024);
    expect(skill.content.trim().length).toBeGreaterThan(0);
  });

  it('only runs wiki-fix and wiki-save when the user asks', () => {
    for (const skill of skills) {
      const manual = skill.name === 'wiki-fix' || skill.name === 'wiki-save';
      expect(skill.data['disable-model-invocation'] === true, skill.name).toBe(manual);
    }
  });
});

describe('agent and rules', () => {
  it('ships the Wiki Librarian agent', () => {
    expect(agentFiles).toEqual(['wiki-librarian.agent.md']);
    const agent = matter(readFileSync(join(PLUGIN, 'com.github.copilot', 'agents', agentFiles[0]), 'utf-8'));
    expect(agent.data.name).toBe('Wiki Librarian');
    expect(agent.data.description).toBeTruthy();
    // Harness-specific fields would make the agent fail in other harnesses.
    expect(Object.keys(agent.data).sort()).toEqual(['description', 'name']);
  });

  it('ships the wiki instructions scoped to .wiki/**', () => {
    expect(ruleFiles).toEqual(['llmwiki.instructions.md']);
    const rule = matter(readFileSync(join(PLUGIN, 'com.github.copilot', 'rules', ruleFiles[0]), 'utf-8'));
    expect(rule.data.applyTo).toBe('.wiki/**');
  });
});

describe('VS Code extension contributions', () => {
  const contributes = extensionPkg.contributes;

  it('no longer contributes a chat participant', () => {
    expect(contributes.chatParticipants).toBeUndefined();
  });

  it('contributes every plugin skill, the agent and the instructions from out/chat', () => {
    const skillPaths = contributes.chatSkills.map((s: { path: string }) => s.path).sort();
    expect(skillPaths).toEqual(skillNames.map((n) => `./out/chat/skills/${n}/SKILL.md`));
    expect(contributes.chatAgents.map((a: { path: string }) => a.path)).toEqual(
      agentFiles.map((f) => `./out/chat/agents/${f}`),
    );
    expect(contributes.chatInstructions.map((i: { path: string }) => i.path)).toEqual(
      ruleFiles.map((f) => `./out/chat/instructions/${f}`),
    );
  });

  it('only offers them in wiki workspaces', () => {
    for (const entry of [...contributes.chatSkills, ...contributes.chatAgents, ...contributes.chatInstructions]) {
      expect(entry.when, entry.path).toBe('llmwiki.isWikiWorkspace');
    }
  });

  it('requires a VS Code version that supports extension-contributed skills', () => {
    expect(extensionPkg.engines.vscode).toBe('^1.109.0');
    expect(extensionPkg.devDependencies['@types/vscode']).toBe('~1.109.0');
  });
});

describe('tool references', () => {
  const referenced = (text: string) => new Set(text.match(/\bwiki_[a-z_]+\b/g) ?? []);

  async function promptTexts(): Promise<string> {
    const server = createMcpServer({ cwd: REPO });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const texts: string[] = [];
    for (const prompt of PROMPTS) {
      const args = 'arguments' in prompt ? Object.fromEntries(prompt.arguments.map((a) => [a.name, 'x'])) : undefined;
      const result = await client.getPrompt({ name: prompt.name, arguments: args });
      for (const m of result.messages) if ('text' in m.content) texts.push(m.content.text);
    }
    return texts.join('\n');
  }

  it('only mention tools the MCP server provides', async () => {
    const sources: Record<string, string> = {
      'server instructions': buildInstructions(undefined, { discovery: true }),
      'MCP prompts': await promptTexts(),
      'agent': readFileSync(join(PLUGIN, 'com.github.copilot', 'agents', agentFiles[0]), 'utf-8'),
      'rules': readFileSync(join(PLUGIN, 'com.github.copilot', 'rules', ruleFiles[0]), 'utf-8'),
    };
    for (const skill of skills) sources[`skill ${skill.name}`] = skill.content;

    for (const [where, text] of Object.entries(sources)) {
      for (const name of referenced(text)) {
        expect(TOOL_NAMES.has(name), `${where} mentions unknown tool ${name}`).toBe(true);
      }
    }
    expect(referenced(BASE_INSTRUCTIONS).size).toBeGreaterThan(5);
  });
});

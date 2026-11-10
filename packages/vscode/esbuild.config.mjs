import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['vscode', 'pdfjs-dist'],
  format: 'cjs',
  outfile: 'out/extension.js',
  sourcemap: true,
  minify: production,
  treeShaking: true,
};

// The MCP server runs as its own Node process, spawned by the extension's
// `McpServerDefinitionProvider`. We bundle it into a self-contained script so
// the launcher works in the packaged VSIX (which ships `--no-dependencies` and
// therefore has no `node_modules/@llmwiki/core` to `require.resolve`).
const mcpBuildOptions = {
  entryPoints: ['../core/dist/mcp/bin.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  format: 'cjs',
  outfile: 'out/mcp-server.cjs',
  sourcemap: true,
  minify: production,
  treeShaking: true,
};

// The agent plugin (../../plugin) ships the same server as a committed,
// self-contained bundle so `copilot plugin install microsoft/llmwiki:plugin`
// works without npm. Always minified and without a source map so the output
// is identical on every machine; CI fails if the committed copy is stale.
const pluginServerBuildOptions = {
  ...mcpBuildOptions,
  outfile: '../../plugin/server/llmwiki-mcp.cjs',
  sourcemap: false,
  minify: true,
  legalComments: 'eof',
};

// Skills, the custom agent and the instructions file are authored once in the
// agent plugin and contributed by the extension (package.json `chatSkills`,
// `chatAgents`, `chatInstructions`) from these copies.
async function copyChatCustomizations() {
  await rm('out/chat', { recursive: true, force: true });
  await cp('../../plugin/skills', 'out/chat/skills', { recursive: true });
  await cp('../../plugin/com.github.copilot/agents', 'out/chat/agents', { recursive: true });
  await cp('../../plugin/com.github.copilot/rules', 'out/chat/instructions', { recursive: true });
}

await copyChatCustomizations();

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  const mcpCtx = await esbuild.context(mcpBuildOptions);
  await ctx.watch();
  await mcpCtx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  await esbuild.build(mcpBuildOptions);
  await esbuild.build(pluginServerBuildOptions);
  console.log(`Build complete: out/extension.js${production ? ' (minified)' : ''}, plugin/server/llmwiki-mcp.cjs`);
}

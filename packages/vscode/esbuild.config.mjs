import * as esbuild from 'esbuild';

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

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  const mcpCtx = await esbuild.context(mcpBuildOptions);
  await ctx.watch();
  await mcpCtx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  await esbuild.build(mcpBuildOptions);
  console.log(`Build complete: out/extension.js${production ? ' (minified)' : ''}`);
}

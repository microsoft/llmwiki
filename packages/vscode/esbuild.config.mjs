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

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log(`Build complete: out/extension.js${production ? ' (minified)' : ''}`);
}

/**
 * Bundles the integration test runner and suite into ./out (CommonJS) so
 * they can run without ts-node. Used by `npm run test:integration`.
 */
import * as esbuild from 'esbuild';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const suiteFiles = readdirSync(join(here, 'suite'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join(here, 'suite', f));

await esbuild.build({
  entryPoints: [join(here, 'runTest.ts'), ...suiteFiles],
  outdir: join(here, 'out'),
  outbase: here,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode', 'mocha', '@vscode/test-electron'],
  sourcemap: true,
  logLevel: 'warning',
});

// The repo root is "type": "module"; the bundles are CommonJS.
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', 'package.json'), '{ "type": "commonjs" }\n');

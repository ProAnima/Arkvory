import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { cleanBuild } from './gates/clean-build.mjs';

const { units } = JSON.parse(await readFile('config/architecture.json', 'utf8'));
const order = units.map((unit) => unit.path);
await cleanBuild(process.cwd(), units);
for (const project of order) {
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', `${project}/tsconfig.build.json`],
    { stdio: 'inherit' },
  );
}
const { openApiDocument } = await import('../packages/contracts/dist/index.js');
await writeFile(
  'packages/contracts/dist/openapi.json',
  JSON.stringify(openApiDocument, null, 2) + '\n',
);
await mkdir('apps/web/public', { recursive: true });
await build({
  entryPoints: ['apps/web/src/console.ts', 'apps/web/src/hash-worker.ts'],
  outdir: 'apps/web/public',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  minify: true,
  legalComments: 'inline',
});
await build({
  entryPoints: ['apps/web/src/appearance-init.ts'],
  outdir: 'apps/web/public',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2023',
  minify: true,
});
for (const file of ['index.html', 'tokens.css'])
  await copyFile(`apps/web/${file}`, `apps/web/public/${file}`);
await build({
  entryPoints: ['apps/web/style.css'],
  outfile: 'apps/web/public/style.css',
  bundle: true,
});
await copyFile('node_modules/@noble/hashes/LICENSE', 'apps/web/public/THIRD-PARTY.txt');

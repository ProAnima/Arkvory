import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const order = [
  'packages/domain',
  'packages/contracts',
  'packages/application',
  'packages/infrastructure',
  'packages/proget-compat',
  'packages/sdk',
  'apps/api',
  'apps/worker',
  'apps/scheduler',
  'apps/web',
];
for (const project of order) {
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', `${project}/tsconfig.build.json`],
    { stdio: 'inherit' },
  );
}
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
for (const file of ['index.html', 'style.css'])
  await copyFile(`apps/web/${file}`, `apps/web/public/${file}`);
await copyFile('node_modules/@noble/hashes/LICENSE', 'apps/web/public/THIRD-PARTY.txt');

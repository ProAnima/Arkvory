import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
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
for (const name of ['arkvory.svg', 'arkvory.ico', 'arkvory.png'])
  await copyFile(`branding/icons/${name}`, `apps/web/public/${name}`);
await build({
  entryPoints: ['apps/web/style.css'],
  outfile: 'apps/web/public/style.css',
  bundle: true,
});
// Third-party texts shipped with the console: the hash library and the flags beside the languages.
await writeFile(
  'apps/web/public/THIRD-PARTY.txt',
  [
    await readFile('node_modules/@noble/hashes/LICENSE', 'utf8'),
    'flag-icons (flags of the language switch, apps/web/flags)',
    await readFile('apps/web/flags/LICENSE', 'utf8'),
  ].join('\n\n'),
);
await mkdir('apps/web/public/flags', { recursive: true });
for (const name of await readdir('apps/web/flags'))
  if (name.endsWith('.svg'))
    await copyFile(`apps/web/flags/${name}`, `apps/web/public/flags/${name}`);
// The console's other languages. A translator's file keeps the English each text was made from
// (tests/web-locales.test.mjs finds what English changed since); the console fetches the texts.
await mkdir('apps/web/public/locales', { recursive: true });
for (const name of await readdir('apps/web/locales')) {
  if (!name.endsWith('.json')) continue;
  const entries = JSON.parse(await readFile(`apps/web/locales/${name}`, 'utf8'));
  const texts = Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, entry.text]),
  );
  await writeFile(`apps/web/public/locales/${name}`, JSON.stringify(texts));
}

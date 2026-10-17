import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { mcpLicenses, mcpLicenseText } from '../scripts/client-licenses.mjs';

const listed = new Set(mcpLicenses.map(([name]) => name.split(' ')[0]));
// Licensed separately: the SHA-256 banner of arkvoryctl.mjs (scripts/package-release.mjs).
const elsewhere = new Set(['@noble/hashes']);

test('every package bundled into arkvoryctl has its license text in the client packages', async () => {
  const bundle = await build({
    entryPoints: ['apps/cli/src/main.ts'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    conditions: ['arkvory-source'],
    logLevel: 'silent',
  });
  const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
    path.includes('node_modules/'),
  );
  const packages = new Set(
    inputs.map((path) => {
      const parts = path.split('node_modules/').at(-1).split('/');
      return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    }),
  );
  for (const name of packages)
    assert.ok(listed.has(name) || elsewhere.has(name), `${name} is bundled without a license`);
  // Code the MCP server package compiled into its own files (its build's .pnpm paths).
  const embedded = new Set();
  for (const path of inputs.filter((p) => p.includes('@modelcontextprotocol/server/dist/')))
    for (const match of (await readFile(path, 'utf8')).matchAll(
      /node_modules\/\.pnpm\/(@?[a-z0-9._-]+(?:\+[a-z0-9._-]+)?)@/g,
    ))
      embedded.add(match[1].replace('+', '/'));
  assert.ok(embedded.has('ajv'), [...embedded].join());
  for (const name of embedded) assert.ok(listed.has(name), `${name} is embedded without a license`);
  const text = await mcpLicenseText();
  for (const required of [
    'Apache License',
    'Colin McDonnell',
    'Evgeny Poberezkin',
    'Douglas Christopher Wilson',
  ])
    assert.ok(text.includes(required), required);
});

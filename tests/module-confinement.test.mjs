import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadInstallation, parseModuleSelections } from '../packages/infrastructure/dist/index.js';
import {
  moduleInstallation,
  moduleManifestOf,
  moduleSource,
  packageEntries,
} from './module-fixtures.mjs';

/**
 * Code a signed module runs at import: every way it may reach another file, each recorded as
 * `loaded` or the error code. `own` and `builtin` must load; the others lead out of the
 * verified package: a bare name found in a `node_modules` above it, a relative path above its
 * root, the same name through `require` and `import.meta.resolve`.
 */
const PROBE = `import { createRequire } from 'node:module';
const probe = {};
const attempt = async (name, run) => {
  try {
    await run();
    probe[name] = 'loaded';
  } catch (error) {
    probe[name] = error?.code ?? 'error';
  }
};
await attempt('own', () => import('./lib/own.mjs'));
await attempt('builtin', () => import('node:path'));
await attempt('planted', () => import('arkvory-planted'));
await attempt('relative', () => import('../../../../outside.mjs'));
await attempt('required', () => createRequire(import.meta.url)('arkvory-planted'));
await attempt('resolved', () => import.meta.resolve('arkvory-planted'));
globalThis.arkvoryProbe = probe;
`;

function probePackage(signer) {
  const manifest = { id: 'probe', roles: ['api'], entry: { api: 'files/main.mjs' } };
  const source = moduleSource(moduleManifestOf(manifest));
  return packageEntries({
    signer,
    manifest,
    files: {
      'files/main.mjs': Buffer.concat([Buffer.from(PROBE), source]),
      'files/lib/own.mjs': Buffer.from('export const own = true;\n'),
      'files/LICENSE.md': Buffer.from('# Module terms\n\nTest terms.\n'),
    },
  });
}

test('a signed module imports only its own verified files and Node built-ins', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(probePackage(host.keys.module));
  // What someone else could put above the package: on Windows any local user may create
  // node_modules in C:\ and in C:\ProgramData, and Node looks for a bare name in each parent.
  const planted = join(host.root, 'node_modules', 'arkvory-planted');
  await mkdir(planted, { recursive: true });
  await writeFile(join(planted, 'package.json'), '{"name":"arkvory-planted","main":"index.cjs"}');
  await writeFile(join(planted, 'index.cjs'), 'globalThis.arkvoryPlanted = true;\n');
  await writeFile(join(host.root, 'outside.mjs'), 'globalThis.arkvoryEscaped = true;\n');
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: parseModuleSelections({ format: 1, modules: { probe: { enabled: true } } }),
    installed: host.source(),
    now: Date.now(),
  });
  assert.deepEqual(loaded.refused, []);
  loaded.prepared.get('probe').create({});
  const outside = 'ERR_MODULE_OUTSIDE_PACKAGE';
  assert.deepEqual(globalThis.arkvoryProbe, {
    own: 'loaded',
    builtin: 'loaded',
    planted: outside,
    relative: outside,
    required: outside,
    resolved: outside,
  });
  assert.equal(globalThis.arkvoryPlanted, undefined);
  assert.equal(globalThis.arkvoryEscaped, undefined);
  // The core itself resolves as before once the confinement is in place.
  assert.equal(typeof (await import('node:path')).join, 'function');
  assert.equal(
    typeof (await import('../packages/infrastructure/dist/index.js')).loadInstallation,
    'function',
  );
});

test('an entry whose top-level code never finishes fails alone after the import budget', async (t) => {
  const host = await moduleInstallation(t);
  const manifest = { id: 'stuck', roles: ['api'], entry: { api: 'files/main.mjs' } };
  const hang = Buffer.from('await new Promise(() => undefined);\n');
  await host.install(
    packageEntries({
      signer: host.keys.module,
      manifest,
      files: {
        'files/main.mjs': Buffer.concat([hang, moduleSource(moduleManifestOf(manifest))]),
        'files/LICENSE.md': Buffer.from('# Module terms\n\nTest terms.\n'),
      },
    }),
  );
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: parseModuleSelections({ format: 1, modules: { stuck: { enabled: true } } }),
    installed: host.source(),
    now: Date.now(),
    importBudgetMs: 200,
  });
  assert.throws(() => loaded.prepared.get('stuck').create({}), { code: 'import_timeout' });
});

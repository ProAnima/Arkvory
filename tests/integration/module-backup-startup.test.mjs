import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseModuleSelections, PostgresModuleState } from '@proanima/arkvory-infrastructure';
import { openCaptureSource, sourceConfig } from '../../apps/backup/dist/index.js';
import { setup } from './fixture.mjs';
import { sourceEnv } from './backup-fixture.mjs';
import {
  moduleInstallation,
  moduleManifestOf,
  moduleSource,
  packageEntries,
  modulePackage,
} from '../module-fixtures.mjs';

test('backup supplies persisted module state and refuses all state mutations', async (t) => {
  const installation = await moduleInstallation(t);
  await installation.install(
    modulePackage(
      installation.keys.module,
      {
        id: 'state-reader',
        roles: ['backup'],
        uses: ['module-state'],
      },
      { recordServices: true },
    ),
  );
  const selection = { format: 1, modules: { 'state-reader': { enabled: true } } };
  const f = await setup(t, {
    installedModules: installation.source(),
    modules: parseModuleSelections(selection),
  });
  const state = new PostgresModuleState(f.catalog.sessions, 'state-reader', false);
  await state.compareExchange(null, new Uint8Array([7, 9]));
  const modulesFile = join(f.directory, 'modules-state.json');
  await writeFile(modulesFile, JSON.stringify(selection));
  delete globalThis.arkvoryServices;
  t.after(() => {
    delete globalThis.arkvoryServices;
  });
  const source = await openCaptureSource({
    ...sourceConfig(sourceEnv(f)),
    modulesFile,
    installedModules: installation.source(),
  });
  try {
    const reader = globalThis.arkvoryServices?.['state-reader']?.['module-state'];
    assert.ok(reader, 'backup must start the module and supply its declared state service');
    const snapshot = await reader.read();
    assert.equal(snapshot.revision, '1');
    assert.deepEqual([...snapshot.value], [7, 9]);
    await assert.rejects(reader.compareExchange('1', new Uint8Array([1])), { code: 'read_only' });
    assert.deepEqual([...(await state.read()).value], [7, 9]);
  } finally {
    await source.close();
  }
});

test('backup startup releases its capture session even when module shutdown throws', async (t) => {
  const installation = await moduleInstallation(t);
  const manifest = {
    id: 'broken-provider',
    roles: ['backup'],
    provides: ['sample@1.0.0'],
    entry: { backup: 'files/main.mjs' },
  };
  const source = moduleSource(moduleManifestOf(manifest), { health: 'failed' })
    .toString()
    .replace(
      'async drain() {}',
      "async drain() { globalThis.arkvoryBackupDrainFailureObserved = true; throw Error('drain failed'); }",
    );
  await installation.install(
    packageEntries({
      signer: installation.keys.module,
      manifest,
      files: {
        'files/main.mjs': Buffer.from(source),
        'files/LICENSE.md': Buffer.from('Test module terms.'),
      },
    }),
  );
  await installation.install(
    modulePackage(installation.keys.module, {
      id: 'consumer',
      roles: ['backup'],
      requires: ['sample@^1.0.0'],
    }),
  );
  const selection = {
    format: 1,
    modules: {
      'broken-provider': { enabled: true },
      consumer: { enabled: true },
    },
  };
  const f = await setup(t, {
    installedModules: installation.source(),
    modules: parseModuleSelections(selection),
  });
  const modulesFile = join(f.directory, 'modules.json');
  await writeFile(modulesFile, JSON.stringify(selection));
  const config = {
    ...sourceConfig(sourceEnv(f)),
    modulesFile,
    installedModules: installation.source(),
  };
  delete globalThis.arkvoryBackupDrainFailureObserved;
  t.after(() => {
    delete globalThis.arkvoryBackupDrainFailureObserved;
  });
  await assert.rejects(openCaptureSource(config));
  assert.equal(
    globalThis.arkvoryBackupDrainFailureObserved,
    true,
    'regression must reach failing module drain',
  );
  const client = await f.catalog.sessions.connect();
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(18471,19) AS acquired');
    assert.equal(result.rows[0].acquired, true, 'failed capture must release the singleton lock');
  } finally {
    client.release(true);
  }
});

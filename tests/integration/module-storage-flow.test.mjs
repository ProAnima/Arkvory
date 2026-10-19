import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import {
  parseModuleSelections,
  createLicenseService,
  PostgresLicenceStore,
  licenceVerifier,
  localStorageBackends,
  loadInstallation,
  processModules,
  ModuleStorages,
  probeStorageBackends,
  PostgresStorageIdentities,
} from '@proanima/arkvory-infrastructure';
import { openCaptureSource, sourceConfig } from '../../apps/backup/dist/index.js';
import { sourceEnv } from './backup-fixture.mjs';
import { DirectoryBackend } from '../contracts/directory-backend.mjs';
import { moduleInstallation, moduleManifestOf, packageEntries } from '../module-fixtures.mjs';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, create, base } from './fixture.mjs';

async function storagePackage(signer) {
  const manifest = {
    id: 'sample-store',
    kind: 'storage-backend',
    roles: ['api', 'worker', 'backup'],
    uses: ['blob-store', 'staged-completion', 'license'],
    dataClass: 'layout',
    entry: { api: 'files/main.mjs', worker: 'files/main.mjs', backup: 'files/main.mjs' },
  };
  const result = await build({
    stdin: {
      contents: `
      import { DirectoryBackend } from './tests/contracts/directory-backend.mjs';
      import { existsSync } from 'node:fs';
      import { join } from 'node:path';
      export default {
        manifest: ${JSON.stringify(moduleManifestOf(manifest))},
        parseConfig: config => config, describeConfig: () => null,
        create(context, config) {
          const store = new DirectoryBackend(config.directory);
          context.services['blob-store'].add('data', {
            blobs: store, lifecycle: store, mode: context.mode,
            acceptsWrites: () => !existsSync(join(config.directory, 'stop-writes')),
          });
          context.services['staged-completion']?.add('data', store.staged());
          return { async start() {
              const view = await context.services.license.view();
              const evidence = await context.services.license.evidence();
              const expected = context.role === 'api' ? 'none' : 'invalid';
              if (view.state !== expected || evidence.length !== (context.role === 'api' ? 0 : 1))
                throw Error('license service must read this installation database');
            }, async drain() {}, async stop() {},
            health: () => ({ status: 'ok', code: null }) };
        }
      };`,
      resolveDir: resolve('.'),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return packageEntries({
    signer,
    manifest,
    files: {
      'files/main.mjs': Buffer.from(result.outputFiles[0].contents),
      'files/LICENSE.md': Buffer.from('Test module terms.'),
    },
  });
}

test('installed signed storage handles placement, staged publication and live withdrawal of new writes', async (t) => {
  const installation = await moduleInstallation(t);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-signed-storage-'));
  t.after(() => removeTestDirectory(directory));
  const disk = new DirectoryBackend(directory);
  await disk.initialize();
  await disk.identity();
  await installation.install(await storagePackage(installation.keys.module));
  const selections = {
    format: 1,
    modules: {
      'sample-store': { enabled: true, config: { directory } },
    },
  };
  const f = await setup(t, {
    installedModules: installation.source(),
    modules: parseModuleSelections(selections),
  });
  await f.catalog.pool.query(
    'INSERT INTO arkvory_storage_placement(repository,revision,rules,updated_by) VALUES($1,1,$2,$3)',
    [
      'releases',
      JSON.stringify([
        { id: 'all', backendId: 'sample-store.data', packageGroup: null, minSizeBytes: null },
      ]),
      'test',
    ],
  );
  const bytes = Buffer.from('complete bytes checked by the core');
  const upload = await create(f, bytes);
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().storageBackend, 'sample-store.data');
  const id = upload.json().id;
  const part = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
    },
    payload: bytes,
  });
  assert.equal(part.statusCode, 204, part.body);
  const done = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${id}/complete`,
    headers: f.headers,
  });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().storageBackend, 'sample-store.data');
  assert.equal(done.json().status, 'available');
  await writeFile(join(directory, 'stop-writes'), '');
  const next = await create(f, bytes);
  assert.equal(next.statusCode, 201, next.body);
  assert.equal(next.json().storageBackend, 'default');
  const read = await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers });
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.rawPayload, bytes);
  await otherRoles(f, installation, selections, id, bytes);
});

async function gather(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function otherRoles(f, installation, selections, id, bytes) {
  await f.catalog.pool.query(`INSERT INTO arkvory_license_activations
    (activation_id,licence_id,installation,activation,token,seq,issued_at,refresh_after,not_after)
    VALUES('test-activation','test-licence','test-installation','online','invalid-test-token',1,now(),now(),now())`);
  const modulesFile = join(f.directory, 'modules.json');
  await writeFile(modulesFile, JSON.stringify(selections));
  const capture = await openCaptureSource({
    ...sourceConfig(sourceEnv(f)),
    modulesFile,
    installedModules: installation.source(),
  });
  try {
    assert.deepEqual(
      await gather(capture.blobs.read(id, bytes.length, undefined, 'sample-store.data')),
      bytes,
    );
    assert.equal(capture.blobs.state('sample-store.data'), 'read_only');
  } finally {
    await capture.close();
  }
  const plan = await loadInstallation({
    role: 'worker',
    coreVersion: '0.6.0',
    now: Date.now(),
    installed: installation.source(),
    selections: parseModuleSelections(selections),
  });
  const blobs = localStorageBackends(f.directory, 0, []);
  const host = processModules(
    'worker',
    plan,
    {
      dataDirectory: f.directory,
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
      storage: new ModuleStorages(blobs, false),
      license: () =>
        createLicenseService({
          store: new PostgresLicenceStore(f.catalog.pool),
          verifier: licenceVerifier(),
        }),
      catalog: () => {
        throw Error('unused catalog');
      },
    },
    { write() {} },
  );
  try {
    await host.runtime.start();
    assert.equal(
      host.runtime.states().find((s) => s.module.manifest.id === 'sample-store').running,
      true,
    );
    await probeStorageBackends(blobs, new PostgresStorageIdentities(f.catalog.pool), {
      create: false,
    });
    assert.deepEqual(
      await gather(blobs.read(id, bytes.length, undefined, 'sample-store.data')),
      bytes,
    );
  } finally {
    await host.close();
  }
}

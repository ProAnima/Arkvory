import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_SERVICES } from '../packages/extension-api/dist/index.js';
import { CONTRACT_SUITES } from '../packages/extension-testkit/dist/index.js';
import * as testkit from '../packages/extension-testkit/dist/index.js';
import { ModuleHostServices, PROVIDED_HOST_SERVICES } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

// What the core gives modules (ADR 0083, section 2.4) and the rule that a service enters the
// contract only with its suite (section 1).
test('every host service the core provides has a contract suite in extension-testkit', () => {
  for (const service of PROVIDED_HOST_SERVICES) {
    assert.ok(HOST_SERVICES.includes(service), service);
    const suite = CONTRACT_SUITES[service];
    assert.equal(typeof testkit[suite], 'function', `${service} needs a suite`);
  }
});

function planned(uses, roles = ['api']) {
  return { manifest: { id: 'op-index', uses, roles }, source: 'operator', enabled: true };
}

test('a module receives only the services its manifest declares', async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'arkvory-host-services-'));
  t.after(() => removeTestDirectory(dataDirectory));
  let built = 0;
  const host = new ModuleHostServices({
    dataDirectory,
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    catalog: () => {
      built++;
      return { catalog: { name: 'catalog' }, content: { name: 'content' } };
    },
  });
  t.after(() => host.close());
  assert.deepEqual(Object.keys(host.for(planned([]), null)), []);
  assert.equal(built, 0, 'nothing is built for a module that uses no catalog service');
  const reader = host.for(planned(['catalog-read']), null);
  assert.deepEqual(Object.keys(reader), ['catalog-read']);
  const both = host.for(planned(['catalog-read', 'content-read', 'data-directory']), {
    dataMiB: 1,
    dataFiles: 2,
  });
  assert.deepEqual(Object.keys(both).sort(), ['catalog-read', 'content-read', 'data-directory']);
  assert.equal(built, 1, 'one catalog service for the process');
  const files = both['data-directory'].data;
  assert.deepEqual(files.usage(), { bytes: 0, files: 0, quotaBytes: 1024 * 1024, quotaFiles: 2 });
  const sink = await files.create('a', { durable: false, exclusive: true });
  await sink.write(new Uint8Array(3));
  await sink.close();
  assert.equal(files.usage().files, 1);
  // Without an approved size every write exceeds the quota; reading stays possible.
  const none = host.for(planned(['data-directory']), null)['data-directory'].cache;
  await assert.rejects(none.create('b', { durable: false, exclusive: false }), {
    code: 'module_quota_exceeded',
  });
});

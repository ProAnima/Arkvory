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
// `routes` is served by the API process itself, not by an implementation a module could
// replace: its suite is tests/module-routes.test.mjs and tests/integration/module-routes.test.mjs.
const HOSTED_IN_THE_API = new Set(['routes']);

test('every host service the core provides has a contract suite in extension-testkit', () => {
  for (const service of PROVIDED_HOST_SERVICES) {
    assert.ok(HOST_SERVICES.includes(service), service);
    if (HOSTED_IN_THE_API.has(service)) continue;
    const suite = CONTRACT_SUITES[service];
    assert.equal(typeof testkit[suite], 'function', `${service} needs a suite`);
  }
});

function planned(uses, roles = ['api'], id = 'op-index') {
  return { manifest: { id, uses, roles }, source: 'operator', enabled: true };
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
      return {};
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
  assert.equal(built, 1, 'one set of catalog use cases for the process');
  const files = both['data-directory'].data;
  assert.deepEqual(files.usage(), { bytes: 0, files: 0, quotaBytes: 1024 * 1024, quotaFiles: 2 });
  // A writable runtime must supply the shared admission pool; no local-only fallback.
  await assert.rejects(files.create('a', { durable: false, exclusive: true }), {
    code: 'unavailable',
  });
});

test('a scope reads only through the services of the module it was made for', async (t) => {
  const seen = [];
  const host = new ModuleHostServices({
    dataDirectory: tmpdir(),
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    catalog: () => ({
      artifact: async (principals) => {
        seen.push(principals.map((principal) => principal.id));
        return null;
      },
    }),
  });
  t.after(() => host.close());
  const principal = {
    credential: 'file-key',
    id: 'reader',
    repositories: ['releases'],
    permissions: ['read'],
  };
  const scope = host.scopes('op-index').of([principal]);
  // The caller's object changes later: the scope keeps the principal it was made with.
  principal.permissions.push('write');
  const own = host.for(planned(['catalog-read']), null)['catalog-read'];
  const other = host.for(planned(['catalog-read'], ['api'], 'op-other'), null)['catalog-read'];
  const id = '00000000-0000-4000-8000-000000000001';
  await own.artifact(scope, 'releases', id);
  await other.artifact(scope, 'releases', id);
  assert.deepEqual(seen, [['reader'], []]);
  assert.ok(Object.isFrozen(host.scopes('op-index').principalsOf(scope)[0].permissions));
  assert.deepEqual(host.scopes('op-index').principalsOf(scope)[0].permissions, ['read']);
});

test('stopping the host revokes scopes and intersections before module drain', () => {
  const host = new ModuleHostServices({
    dataDirectory: '.',
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    catalog: () => ({}),
  });
  const scopes = host.scopes('echo');
  const root = scopes.of([{ id: 'owner', repositories: ['releases'], permissions: ['read'] }]);
  const child = scopes.intersect(root, root);
  assert.equal(scopes.principalsOf(child).length, 2);
  host.stop();
  assert.deepEqual(scopes.principalsOf(child), []);
  assert.deepEqual(scopes.principalsOf(host.scopes('later').of([{ id: 'owner' }])), []);
  host.close();
});

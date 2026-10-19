import assert from 'node:assert/strict';
import test from 'node:test';
import { activateLicence, refreshLicence } from '@proanima/arkvory-application';
import { createLicenseService, exportedTables, migrate } from '@proanima/arkvory-infrastructure';
import { licenseContract } from '../../packages/extension-testkit/dist/index.js';
import { INSTALLATION, licenceSetup } from './licence-fixture.mjs';

test('migration 47 adds licences after moves and trees; repeating it preserves activations', async (t) => {
  const f = await licenceSetup(t, { upTo: 46 });
  const before = await f.pool.query(`SELECT to_regclass('arkvory_license_activations') AS licenses,
    to_regclass('arkvory_blob_moves') AS moves, to_regclass('arkvory_tree_indexes') AS trees`);
  assert.equal(before.rows[0].licenses, null);
  assert.equal(before.rows[0].moves, 'arkvory_blob_moves');
  assert.equal(before.rows[0].trees, 'arkvory_tree_indexes');
  await migrate(f.pool);
  f.hub.licence(f.key);
  const activated = await activateLicence(f.env, { key: f.key, installation: INSTALLATION });
  assert.equal(activated.outcome, 'activated');
  const rows = await f.pool.query('SELECT * FROM arkvory_license_activations');
  await migrate(f.pool);
  assert.deepEqual(
    (await f.pool.query('SELECT * FROM arkvory_license_activations')).rows,
    rows.rows,
  );
  assert.deepEqual(
    (
      await f.pool.query(
        'SELECT version FROM arkvory_migrations WHERE version BETWEEN 45 AND 47 ORDER BY version',
      )
    ).rows.map((row) => row.version),
    [45, 46, 47],
  );
  for (const table of exportedTables.filter((entry) => entry.name.startsWith('arkvory_license_')))
    assert.equal(table.since, 47);
});

licenseContract('PostgreSQL licence host service', async (t) => {
  const f = await licenceSetup(t);
  let activationId;
  let licenseId;
  const evidence = async (kind, column) => {
    const result = await f.pool.query(
      `SELECT ${column} AS document FROM arkvory_license_activations WHERE activation_id=$1`,
      [activationId],
    );
    return { licenseId, kind, document: new TextEncoder().encode(result.rows[0].document) };
  };
  return {
    service: createLicenseService(f.env, { ttlMs: 0 }),
    feature: 'dedup',
    async activate() {
      f.hub.licence(f.key);
      const result = await activateLicence(f.env, { key: f.key, installation: INSTALLATION });
      assert.equal(result.outcome, 'activated');
      activationId = result.activationId;
      licenseId = result.licenceId;
      return evidence('activation', 'token');
    },
    async revoke() {
      [...f.hub.licences.values()][0].state = 'revoked';
      const result = await refreshLicence(f.env, activationId);
      assert.equal(result.outcome, 'revoked');
      return evidence('revocation', 'revocation');
    },
  };
});

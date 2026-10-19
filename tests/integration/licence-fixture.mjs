import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { licenceEnvironment, licencePool, migrate } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from '../helpers.mjs';
import { DAY, licenceAuthority, licenceKeyText } from '../licence-fixtures.mjs';
import { licenceHubStub } from './licence-hub-stub.mjs';

export const INSTALLATION = '3f2b8c1e-7d4a-4e9b-a6c5-0f1e2d3c4b5a';

/**
 * A migrated schema of its own, a secrets directory, a test licence authority and a stub hub on
 * loopback; the environment is the production one with the authority's root and no pauses
 * between the repeats of a lost answer.
 */
export async function licenceSetup(t, options = {}) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('ARKVORY_TEST_DATABASE_URL is required; use a dedicated test database');
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  const schema = 'arkvory_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = licencePool(url.toString());
  const root = await mkdtemp(join(tmpdir(), 'arkvory-licence-'));
  const directory = join(root, 'licenses');
  await mkdir(directory, { mode: 0o700 });
  const authority = licenceAuthority(Date.now() - 100 * DAY);
  const hub = await licenceHubStub(authority);
  t.after(async () => {
    await hub.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await removeTestDirectory(root);
  });
  await migrate(pool, options.upTo === undefined ? {} : { upTo: options.upTo });
  const configuration = {
    directory,
    hub: { url: hub.url, project: 'arkvory' },
    installation: options.installation ?? INSTALLATION,
    modulesDirectory: undefined,
  };
  const base = licenceEnvironment(pool, configuration, '1.2.3', { roots: authority.roots });
  const env = {
    ...base,
    sleep: async () => undefined,
    modules: async () => [{ id: 'paid-store', version: '1.0.0' }],
  };
  const key = licenceKeyText();
  return {
    pool,
    schema,
    url: url.toString(),
    root,
    directory,
    authority,
    hub,
    configuration,
    env,
    key,
  };
}

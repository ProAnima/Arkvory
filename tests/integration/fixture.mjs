import { removeTestDirectory } from '../helpers.mjs';
import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../apps/api/dist/index.js';
import { PostgresCatalog, migrate } from '@proanima/arkvory-infrastructure';

export async function setup(t, overrides = {}, lifecycle = {}) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('ARKVORY_TEST_DATABASE_URL is required; use a dedicated test database');
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  const schema = 'depot_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-http-'));
  const token = 'test-' + randomUUID() + randomUUID();
  const reader = 'read-' + randomUUID() + randomUUID();
  const config = {
    databaseUrl: url.toString(),
    dataDirectory: directory,
    host: '127.0.0.1',
    port: 0,
    capacityBytes: 16 * 1024 ** 3,
    maxUploads: 2,
    maxDownloads: 2,
    keys: [
      {
        sha256: createHash('sha256').update(token).digest('hex'),
        principal: {
          id: 'test-writer',
          repositories: ['releases'],
          permissions: ['read', 'write'],
          administrator: true,
        },
      },
      {
        sha256: createHash('sha256').update(reader).digest('hex'),
        principal: { id: 'test-reader', repositories: ['releases'], permissions: ['read'] },
      },
    ],
    ...overrides,
  };
  const catalog = new PostgresCatalog(config.databaseUrl, config.capacityBytes, config.maxUploads);
  let app;
  t.after(async () => {
    if (app) await app.close();
    await catalog.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await removeTestDirectory(directory);
  });
  await migrate(catalog.pool);
  await migrate(catalog.pool);
  app = await createServer(config, lifecycle);
  const headers = { authorization: `Bearer ${token}` };
  return {
    get app() {
      return app;
    },
    config,
    catalog,
    headers,
    readerHeaders: { authorization: `Bearer ${reader}` },
    directory,
    async restart() {
      await app.close();
      app = await createServer(config, lifecycle);
      return app;
    },
    async listen() {
      return app.listen({ host: '127.0.0.1', port: 0 });
    },
  };
}

export const descriptor = (data) => ({
  name: 'artifact.upack',
  size: String(data.length),
  sha256: createHash('sha256').update(data).digest('hex'),
  labels: ['release', 'linux'],
  metadata: { version: '1.0' },
});
export const base = '/api/v1/repositories/releases';
export async function create(f, data, key = randomUUID()) {
  const response = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': key },
    payload: descriptor(data),
  });
  return response;
}

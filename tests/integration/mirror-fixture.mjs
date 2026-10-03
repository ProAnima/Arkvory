import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ZipFile } from 'yazl';
import { createServer } from '../../apps/api/dist/index.js';
import { MirrorSync, StageImport } from '@proanima/arkvory-application';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresContentPins,
  PostgresMirrorState,
  migrate,
} from '@proanima/arkvory-infrastructure';
import { SdkMirrorSource } from '../../apps/worker/dist/mirror-source.js';
import { ServiceMirrorTarget } from '../../apps/worker/dist/mirror-target.js';
import { setup, base } from './fixture.mjs';
import { dropTestDatabase, removeTestDirectory } from '../helpers.mjs';

export const never = { throwIfAborted() {} };

export async function upack(version) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({ name: 'app', version })), 'upack.json');
  zip.addBuffer(Buffer.from('build ' + version), 'package/build.txt');
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Publishes bytes on an instance with its writer key through a single content upload. */
export async function publish(f, bytes, name = 'file.bin') {
  const created = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: {
      name,
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: [],
      metadata: {},
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

export const call = async (f, method, url, payload, expected = 200) => {
  const response = await f.app.inject({
    method,
    url: `${base}${url}`,
    headers: f.headers,
    payload,
  });
  assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
  return response;
};

export const key = (id, permissions, administrator = false) => {
  const token = `${id}-${randomUUID()}${randomUUID()}`;
  const sha256 = createHash('sha256').update(token).digest('hex');
  return {
    token,
    entry: { sha256, principal: { id, repositories: ['releases'], permissions, administrator } },
  };
};

/**
 * The mirror installation in its own database: advisory locks of the writer are database-wide,
 * so a second writer cannot share the source's database (other schemas or not). One cleanup in
 * the right order: server, pools, then the database and the storage directory.
 */
export async function mirrorInstance(t, upstream, stages) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('ARKVORY_TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  const name = `${url.pathname.slice(1)}_mirror_${randomBytes(6).toString('hex')}`;
  assert.match(name, /^[a-z0-9_]{1,63}$/);
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  url.pathname = '/' + name;
  url.searchParams.delete('options');
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-mirror-'));
  const writer = key('mirror-writer', ['read', 'write'], true);
  const reader = key('mirror-reader', ['read']);
  const config = {
    databaseUrl: url.toString(),
    dataDirectory: directory,
    host: '127.0.0.1',
    port: 0,
    capacityBytes: 16 * 1024 ** 3,
    maxUploads: 2,
    maxDownloads: 2,
    keys: [writer.entry, reader.entry],
    mirrors: [
      {
        repository: 'releases',
        upstream,
        sourceRepository: 'releases',
        ...(stages ? { stages } : {}),
      },
    ],
  };
  const migrations = new PostgresCatalog(config.databaseUrl, 0, 1);
  const closers = [() => migrations.close()];
  t.after(async () => {
    try {
      for (const close of closers.reverse()) await close();
    } finally {
      await dropTestDatabase(admin, name);
      await admin.end();
      await removeTestDirectory(directory);
    }
  });
  await migrate(migrations.pool);
  const app = await createServer(config);
  closers.push(() => app.close());
  return {
    app,
    config,
    directory,
    headers: { authorization: `Bearer ${writer.token}` },
    readerHeaders: { authorization: `Bearer ${reader.token}` },
    release: (close) => closers.push(close),
  };
}

/** Source and mirror installations; the mirror's worker side is driven step by step. */
export async function pair(t, stages) {
  const source = await setup(t);
  const upstream = await source.listen();
  const mirror = await mirrorInstance(t, upstream, stages);
  const blobs = new LocalBlobStore(mirror.directory, 0);
  const catalog = new PostgresCatalog(mirror.config.databaseUrl, mirror.config.capacityBytes, 2);
  const stop = new AbortController();
  const pins = new PostgresContentPins(catalog.pool);
  mirror.release(async () => {
    stop.abort();
    await pins.close();
    await catalog.close();
  });
  await catalog.claimStorage(await blobs.identity(), 'worker');
  const reader = source.readerHeaders.authorization.slice(7);
  const target = new ServiceMirrorTarget('releases', catalog, blobs, mirror.directory, pins);
  const make = (upstreamSource) => {
    const dependencies = {
      repository: 'releases',
      source: [upstream, 'releases', ...(stages ?? [])].join('|'),
      upstream: upstreamSource,
      target,
      states: new PostgresMirrorState(catalog.pool),
      now: () => new Date().toISOString(),
    };
    return stages ? new StageImport({ ...dependencies, stages }) : new MirrorSync(dependencies);
  };
  const port = (address) => new SdkMirrorSource(address, 'releases', () => reader, stop.signal);
  const sourcePort = port(upstream);
  /** The source port with counted range reads; `fail` names the call (1-based) that breaks. */
  const counted = (fail = 0) => {
    const counter = { ranges: 0 };
    const methods = ['changes', 'artifacts', 'packages', 'assets', 'artifact', 'annotation'];
    const wrapped = Object.fromEntries(
      [...methods, 'stages', 'asset'].map((name) => [name, (...args) => sourcePort[name](...args)]),
    );
    wrapped.content = async (...args) => {
      if (++counter.ranges === fail) throw new Error('connection lost');
      return sourcePort.content(...args);
    };
    return { counter, port: wrapped };
  };
  // A fresh synchronization per phase, as after a worker restart: state comes from the database.
  const settle = async (upstreamSource = sourcePort) => {
    const worker = make(upstreamSource);
    for (let step = 0; step < 200; step++) if ((await worker.step(never)) === 'idle') return;
    throw new Error('The mirror did not catch up');
  };
  /** Deletions need a managed key with artifact.delete, issued by the bootstrap key. */
  const deleter = async () => {
    source.config.keys[0].principal.serviceAdministrator = true;
    const root = new ArkvoryClient(upstream, () => source.headers.authorization.slice(7));
    const bindings = [
      { resource: { kind: 'repository', id: 'releases' }, actions: ['artifact.delete'] },
    ];
    const account = await root.createServiceAccount('mirror-test-deleter', bindings);
    const issued = await root.issueServiceKey(account.id, 'issue-deleter', {
      name: 'deleter',
      bindings,
    });
    await new ArkvoryClient(upstream, () => issued.secret).activateServiceKey();
    return { authorization: 'Bearer ' + issued.secret };
  };
  return { source, mirror, catalog, target, port, counted, make, settle, deleter };
}

export const content = async (f, url) => {
  const response = await f.app.inject({ url: `${base}${url}`, headers: f.readerHeaders });
  assert.equal(response.statusCode, 200, response.body);
  return response.rawPayload;
};

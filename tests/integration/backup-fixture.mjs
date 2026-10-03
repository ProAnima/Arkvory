import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { CaptureBackup } from '@proanima/arkvory-application';
import { FileVault, LocalBlobStore, PostgresOnlineCleanup } from '@proanima/arkvory-infrastructure';
import {
  captureDependencies,
  openCaptureSource,
  openVault,
  sourceConfig,
} from '../../apps/backup/dist/index.js';
import { dropTestDatabase, removeTestDirectory } from '../helpers.mjs';
import { base, create } from './fixture.mjs';

export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A fresh temp directory (removed after the test) and the not yet existing path inside it. */
export async function scratch(t, prefix, name) {
  const directory = await mkdtemp(join(tmpdir(), `arkvory-${prefix}-`));
  t.after(() => removeTestDirectory(directory));
  return join(directory, name);
}

export async function newVault(t) {
  const path = await scratch(t, 'vault', 'vault');
  const identity = await FileVault.initialize(path, {
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  return { path, identity };
}

export function sourceEnv(f, extra = {}) {
  return { ARKVORY_DATABASE_URL: f.config.databaseUrl, ARKVORY_DATA_DIR: f.directory, ...extra };
}

/** The real operator CLI as a child process: exit code, JSON records and stderr. */
export function runBackup(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['apps/backup/dist/main.js', ...args], {
      env: { ...process.env, ARKVORY_DATABASE_URL: '', ARKVORY_DATA_DIR: '', ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      const records = stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));
      resolve({ code, records, stdout, stderr });
    });
  });
}
export const record = (result, code) => result.records.find((entry) => entry.code === code);

export async function publish(f, bytes = randomBytes(64 * 1024)) {
  const made = await create(f, bytes);
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().id;
  const done = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  return { id, bytes };
}

/** Logical deletion as retention records it; bytes stay until physical cleanup. */
export async function retire(f, ids) {
  await f.catalog.pool.query(
    `UPDATE arkvory_uploads SET status='cancelled', cancelled_at=now()-interval '1 hour'
     WHERE id=ANY($1::uuid[]) AND status='available'`,
    [ids],
  );
}

/** Enabled online cleanup with no grace, driven explicitly by sweep(). */
export async function enableCleanup(f) {
  await f.catalog.pool.query(
    `INSERT INTO arkvory_cleanup_settings(repository,revision,policy,next_run_at)
     VALUES('releases',1,$1,now()+interval '1 day')`,
    [
      JSON.stringify({
        enabled: true,
        graceHours: 0,
        batchSize: 100,
        intervalSeconds: 86400,
        delayMilliseconds: 0,
      }),
    ],
  );
}

/** In-process capture over the CLI composition; `wrap` may replace any dependency. */
export async function capture(f, vaultPath, key, wrap = (deps) => deps, env = {}) {
  const config = sourceConfig(sourceEnv(f, { ARKVORY_BACKUP_LEASE_SECONDS: '5', ...env }));
  const vault = await openVault(vaultPath, f.directory);
  const source = await openCaptureSource(config);
  try {
    const deps = captureDependencies(source, vault, {
      config,
      release: { version: 'dev', commit: null },
    });
    return await new CaptureBackup(wrap(deps, source)).run(key);
  } finally {
    await source.close();
  }
}

/**
 * A database created for one test. Closers registered with release() run first (last in, first
 * out), then the database is dropped with force.
 */
export async function temporaryDatabase(t) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  const url = new URL(connectionString);
  const name = `${url.pathname.slice(1)}_restore_${randomBytes(6).toString('hex')}`;
  assert.match(name, /^[a-z0-9_]{1,63}$/);
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  const closers = [];
  t.after(async () => {
    try {
      for (const close of closers.reverse()) await close();
    } finally {
      await dropTestDatabase(admin, name);
      await admin.end();
    }
  });
  url.pathname = '/' + name;
  url.searchParams.delete('options');
  return { url: url.toString(), release: (close) => closers.push(close) };
}

/**
 * Pause point inside a dependency. A forgotten release fails the paused operation after 30 s
 * instead of holding database sessions that would block the fixture teardown forever.
 */
export function gate() {
  const opened = Promise.withResolvers();
  const released = Promise.withResolvers();
  const timer = setTimeout(() => released.reject(new Error('Test gate was never released')), 30000);
  timer.unref();
  released.promise.then(
    () => clearTimeout(timer),
    () => undefined,
  );
  return {
    entered: opened.promise,
    async wait() {
      opened.resolve();
      await released.promise;
    },
    release: () => released.resolve(),
  };
}

/** Delegates to target, with some methods replaced (a fault or a pause at one boundary). */
export function override(target, methods) {
  return new Proxy(target, {
    get(object, name) {
      if (Object.hasOwn(methods, name)) return methods[name];
      const value = Reflect.get(object, name);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}

export async function until(condition, what = 'condition') {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await condition()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for ' + what);
}

/**
 * One online cleanup pass over every candidate. The API timer may run the same due pass first;
 * either way the pass is complete once its result is recorded.
 */
export async function sweep(f, blobs = new LocalBlobStore(f.directory)) {
  await f.catalog.pool.query(
    'UPDATE arkvory_cleanup_settings SET next_run_at=now(), last_run_at=NULL',
  );
  await f.catalog.pool.query("UPDATE arkvory_uploads SET gc_checked_at='1970-01-01'");
  await new PostgresOnlineCleanup(f.catalog.pool, blobs).tick(() => true);
  await until(
    async () =>
      (
        await f.catalog.pool.query(
          'SELECT 1 FROM arkvory_cleanup_settings WHERE last_run_at IS NOT NULL',
        )
      ).rowCount === 1,
    'cleanup pass',
  );
  return (await f.catalog.pool.query('SELECT * FROM arkvory_cleanup_settings')).rows[0];
}

export async function upload(f, id) {
  return (await f.catalog.pool.query('SELECT * FROM arkvory_uploads WHERE id=$1', [id])).rows[0];
}
export async function captureJob(f, key) {
  return (
    await f.catalog.pool.query('SELECT * FROM arkvory_backup_jobs WHERE idempotency_key=$1', [key])
  ).rows[0];
}
export async function protection(f) {
  const barrier = (await f.catalog.pool.query('SELECT * FROM arkvory_backup_barrier')).rows[0];
  const pins = (await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_backup_pins'))
    .rows[0].n;
  return { barrier: barrier.state, pins };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DepotClient } from '@proanima/depot-sdk';
import { defaultCleanupPolicy, serviceActions } from '@proanima/depot-domain';
import {
  LocalBlobStore,
  PostgresOnlineCleanup,
  PostgresContentPins,
} from '@proanima/depot-infrastructure';
import { setup, create, base } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';

async function manager(f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new DepotClient(await f.listen(), () => f.headers.authorization.slice(7));
  const bindings = [{ resource: { kind: 'repository', id: 'releases' }, actions: serviceActions }];
  const account = await root.createServiceAccount('cleanup-manager', bindings);
  const key = await root.issueServiceKey(account.id, randomUUID(), {
    name: 'cleanup-manager',
    bindings,
  });
  const client = new DepotClient(
    'http://127.0.0.1:' + f.app.server.address().port,
    () => key.secret,
  );
  await client.activateServiceKey();
  return { client, headers: { authorization: 'Bearer ' + key.secret } };
}
async function published(f, bytes = Buffer.from(randomUUID())) {
  const made = await create(f, bytes),
    id = made.json().id;
  assert.equal(made.statusCode, 201, made.body);
  const done = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  return id;
}
async function enable(f, client, changes = {}) {
  const state = await client.cleanup('releases');
  await client.configureCleanup('releases', state.revision, {
    ...defaultCleanupPolicy,
    enabled: true,
    graceHours: 0,
    delayMilliseconds: 0,
    intervalSeconds: 86400,
    ...changes,
  });
  // Keep the automatic timer away while exercising the same collector deterministically.
  await f.catalog.pool.query(
    "UPDATE depot_cleanup_settings SET next_run_at=now()+interval '1 day'",
  );
}
async function sweep(f, blobs = new LocalBlobStore(f.directory), active = () => true) {
  await f.catalog.pool.query(
    'UPDATE depot_cleanup_settings SET next_run_at=now(),last_run_at=NULL',
  );
  await f.catalog.pool.query("UPDATE depot_uploads SET gc_checked_at='1970-01-01'");
  await new PostgresOnlineCleanup(f.catalog.pool, blobs).tick(active);
}
async function row(f, id) {
  return (await f.catalog.pool.query('SELECT * FROM depot_uploads WHERE id=$1', [id])).rows[0];
}

test('online cleanup API validates policies, scopes and CAS while reads remain available', async (t) => {
  const f = await setup(t),
    { client, headers } = await manager(f);
  const url = base + '/storage/cleanup';
  const initial = await f.app.inject({ url, headers });
  validateResponse('/api/v1/repositories/{repository}/storage/cleanup', 'get', initial);
  assert.equal(initial.json().policy.enabled, false);
  assert.equal((await f.app.inject({ url, headers: f.headers })).statusCode, 403);
  for (const policy of [
    { ...defaultCleanupPolicy, batchSize: 0 },
    { ...defaultCleanupPolicy, enabled: 'yes' },
    { ...defaultCleanupPolicy, extra: 1 },
  ]) {
    const response = await f.app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { expectedRevision: 0, policy },
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const saved = await client.configureCleanup('releases', 0, defaultCleanupPolicy);
  assert.equal(saved.revision, 1);
  await assert.rejects(client.configureCleanup('releases', 0, defaultCleanupPolicy), {
    status: 409,
    code: 'conflict',
  });
  await assert.rejects(client.requestCleanup('releases', 1), { status: 409, code: 'conflict' });
  const other = await f.app.inject({ url: '/api/v1/repositories/other/storage/cleanup', headers });
  assert.equal(other.statusCode, 403);
  const id = await published(f);
  await enable(f, client);
  await sweep(f);
  assert.equal((await row(f, id)).temp_cleaned, true);
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).statusCode,
    200,
  );
});

test('an active HTTP download survives retirement and GC defers bytes and quota until its close', async (t) => {
  const sharedDownloads = {
    slots: 2,
    slot: 0,
    bytesPerSecond: 131072,
    perPrincipalBytesPerSecond: 131072,
  };
  const f = await setup(t, {
    sharedDownloads,
  });
  const { client } = await manager(f),
    bytes = Buffer.alloc(256 * 1024, 71),
    id = await published(f, bytes);
  await enable(f, client);
  const child = fork('tests/integration/api-child.mjs', [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  try {
    child.send({ ...f.config, role: 'reader', sharedDownloads: { ...sharedDownloads, slot: 1 } });
    const [started] = await once(child, 'message');
    assert.ok(!started.error, started.error);
    const response = await fetch(`${started.address}${base}/artifacts/${id}/content`, {
      headers: f.headers,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(),
      first = await reader.read();
    assert.equal(first.done, false);
    await client.deleteArtifact('releases', id, 0);
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, false);
    await access(join(f.directory, 'blobs', id));
    const chunks = [first.value];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, true);
    await assert.rejects(access(join(f.directory, 'blobs', id)), { code: 'ENOENT' });
    assert.equal((await client.storageUsage('releases')).retiredBytes, '0');
    // A disconnected client must release the source pin without waiting for the full transfer.
    const interrupted = await published(f, bytes),
      controller = new AbortController();
    const aborted = await fetch(`${started.address}${base}/artifacts/${interrupted}/content`, {
      headers: f.headers,
      signal: controller.signal,
    });
    const body = aborted.body.getReader();
    await body.read();
    await client.deleteArtifact('releases', interrupted, 0);
    controller.abort();
    await body.cancel().catch(() => undefined);
    const deadline = Date.now() + 3000;
    do {
      await sweep(f);
      if ((await row(f, interrupted)).reclaimed) break;
      await delay(50);
    } while (Date.now() < deadline);
    assert.equal((await row(f, interrupted)).reclaimed, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGKILL');
      await ended;
    }
  }
});

test('independent-session content pins are counted and cancelled, failed and expired files retry independently', async (t) => {
  const f = await setup(t),
    { client } = await manager(f),
    id = await published(f);
  const pins = new PostgresContentPins(f.catalog.pool);
  try {
    const one = await pins.acquire(id),
      two = await pins.acquire(id);
    await enable(f, client);
    await sweep(f);
    assert.equal(
      (await row(f, id)).temp_cleaned,
      true,
      'Active readers must not gate temporary cleanup',
    );
    await client.deleteArtifact('releases', id, 0);
    await enable(f, client);
    await one.release();
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, false);
    await two.release();
    const store = new LocalBlobStore(f.directory);
    await sweep(f, {
      collect: async () => {
        throw new Error('Simulated disk error');
      },
    });
    assert.equal((await row(f, id)).reclaimed, false);
    assert.equal((await client.cleanup('releases')).lastFailed, 1);
    // Crash window: bytes were removed, but accounting did not commit.
    await store.collect(id, true, { throwIfAborted() {} });
    assert.equal((await row(f, id)).reclaimed, false);
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, true);
    const pending = (await create(f, Buffer.from('partial'))).json().id;
    await mkdir(join(f.directory, 'staging', pending), { recursive: true });
    await writeFile(join(f.directory, 'staging', pending, 'unfinished'), 'partial');
    await f.catalog.pool.query(
      "UPDATE depot_uploads SET expires_at=now()-interval '1 hour' WHERE id=$1",
      [pending],
    );
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const uploading = f.catalog.exclusive(pending, async () => {
      entered();
      await held;
    });
    await started;
    try {
      await sweep(f);
      assert.equal((await row(f, pending)).status, 'pending');
    } finally {
      release();
      await uploading;
    }
    await sweep(f);
    assert.equal((await row(f, pending)).status, 'cancelled');
    await sweep(f);
    assert.equal((await row(f, pending)).reclaimed, true);
    await assert.rejects(access(join(f.directory, 'staging', pending)), { code: 'ENOENT' });
  } finally {
    await pins.close();
  }
});

test('an active older runtime blocks GC until all gateways support content pins', async (t) => {
  const f = await setup(t),
    { client } = await manager(f),
    id = await published(f);
  await client.deleteArtifact('releases', id, 0);
  await enable(f, client);
  const old = await f.catalog.pool.connect();
  try {
    await old.query('SELECT pg_advisory_lock_shared(18471,4)');
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, false);
    assert.equal((await client.cleanup('releases')).lastError, 'upgrade_required');
    await old.query('SELECT pg_advisory_unlock_shared(18471,4)');
    await sweep(f);
    assert.equal((await row(f, id)).reclaimed, true);
  } finally {
    old.release(true);
  }
});

test('grace, historical references and a live pause prevent physical deletion', async (t) => {
  const f = await setup(t),
    { client } = await manager(f);
  const first = await published(f),
    second = await published(f);
  await client.deleteArtifact('releases', first, 0);
  await client.deleteArtifact('releases', second, 0);
  await enable(f, client, { graceHours: 24 });
  await sweep(f);
  assert.equal((await row(f, first)).reclaimed, false);
  // Defensive check even for inconsistent old imports with a cancelled, pinned row.
  await f.catalog.pool.query(
    "INSERT INTO depot_references(repository,artifact_id,owner,reference) VALUES('releases',$1,'legacy','pin')",
    [first],
  );
  await enable(f, client);
  await sweep(f);
  assert.equal((await row(f, first)).reclaimed, false);
  assert.equal((await row(f, second)).reclaimed, true);
  await f.catalog.pool.query('DELETE FROM depot_references WHERE artifact_id=$1', [first]);
  const third = await published(f);
  await client.deleteArtifact('releases', third, 0);
  let calls = 0;
  const blobs = new LocalBlobStore(f.directory);
  await sweep(f, {
    collect: async (...args) => {
      await blobs.collect(...args);
      calls++;
      const state = await client.cleanup('releases');
      await client.configureCleanup('releases', state.revision, {
        ...state.policy,
        enabled: false,
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal((await client.cleanup('releases')).policy.enabled, false);
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
});

test('background cleanup persists across restart and requires no maintenance ownership', async (t) => {
  const f = await setup(t),
    { client } = await manager(f),
    id = await published(f);
  await client.deleteArtifact('releases', id, 0);
  await enable(f, client);
  await f.restart();
  await f.listen();
  await f.catalog.pool.query('UPDATE depot_cleanup_settings SET next_run_at=now()');
  const deadline = Date.now() + 12000;
  while (!(await row(f, id)).reclaimed && Date.now() < deadline) await delay(100);
  assert.equal((await row(f, id)).reclaimed, true);
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers })).json().features
      .onlineGarbageCollection,
    true,
  );
});

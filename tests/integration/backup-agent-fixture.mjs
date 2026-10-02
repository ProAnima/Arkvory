import { setTimeout as delay } from 'node:timers/promises';
import { agentConfig, runAgent } from '../../apps/backup/dist/index.js';
import { sourceEnv } from './backup-fixture.mjs';

/**
 * The supervised agent in this process, with a 3 s lease and 1 s polling. Tests stop it in a
 * finally block: the schema of the fixture must outlive every agent session.
 */
export function startAgent(f, vault, options = {}) {
  const controller = new AbortController();
  const records = [];
  const config = agentConfig(
    sourceEnv(f, {
      ...(vault ? { ARKVORY_BACKUP_VAULT: vault } : {}),
      ARKVORY_BACKUP_LEASE_SECONDS: '3',
      ARKVORY_BACKUP_POLL_SECONDS: '1',
      ...options.env,
    }),
  );
  const done = runAgent({
    config,
    release: { version: '9.9.9', commit: null },
    logger: { write: (record) => records.push(record) },
    signal: controller.signal,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.owner ? { owner: options.owner } : {}),
  });
  let failure;
  done.catch((error) => {
    failure = error;
  });
  return {
    records,
    has: (code) => records.some((record) => record.code === code),
    get failure() {
      return failure;
    },
    async stop() {
      controller.abort();
      await done;
    },
  };
}

/** Polls a condition for up to `ms` (agent work is asynchronous and polls once per second). */
export async function eventually(condition, what, ms = 30000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + what);
    await delay(50);
  }
}

export async function agentRow(f) {
  return (
    await f.catalog.pool.query(
      `SELECT owner::text, generation::int, lease_until, heartbeat_at, vault_id::text,
        vault_configured, vault_available, vault_free_bytes::text, version
       FROM arkvory_backup_agent WHERE singleton`,
    )
  ).rows[0];
}

export async function requests(f, where = 'true', values = []) {
  return (
    await f.catalog.pool.query(
      `SELECT id::text, kind, depth, state, error_code, point_id::text, idempotency_key,
        requested_by, attempts FROM arkvory_backup_requests WHERE ${where}
       ORDER BY created_at, id`,
      values,
    )
  ).rows;
}

/** JSON call against the in-process API with the administrator key of the fixture. */
export async function api(f, method, url, options = {}) {
  const response = await f.app.inject({
    method,
    url: `/api/v1/backup${url}`,
    headers: {
      ...(options.headers ?? f.headers),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  return { status: response.statusCode, body: response.body ? response.json() : null };
}

export async function savePlan(f, changes) {
  const current = (await api(f, 'GET', '/plan')).body;
  const { revision, ...plan } = current;
  const saved = await api(f, 'PUT', '/plan', {
    payload: { ...plan, ...changes, expectedRevision: revision },
  });
  if (saved.status !== 200) throw new Error(`Plan update failed: ${JSON.stringify(saved.body)}`);
  return saved.body;
}

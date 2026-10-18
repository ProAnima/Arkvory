import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  activateLicence,
  createOfflineRequest,
  deactivateLicence,
  installLicenceDocument,
  licenceOverview,
  refreshDueLicences,
  refreshLicence,
  updateLicenceRevocations,
} from '@proanima/arkvory-application';
import {
  DiagnosticLogger,
  createLicenseService,
  exportedTables,
  licenceKeyDigest,
} from '@proanima/arkvory-infrastructure';
import { runLicences } from '../../apps/worker/dist/license-loop.js';
import { DAY, iso, newId } from '../licence-fixtures.mjs';
import { INSTALLATION, licenceSetup } from './licence-fixture.mjs';

const ACTIVATE_FIELDS = ['coreVersion', 'installId', 'key', 'modules', 'nonce', 'requestedAt'];
const REFRESH_FIELDS = [
  'activationId',
  'activationSecret',
  'coreVersion',
  'modules',
  'nonce',
  'seq',
];
const hubCalls = (hub, route) => hub.requests.filter((r) => r.path.endsWith(`/licence/${route}`));

async function activated(f) {
  f.hub.licence(f.key);
  const result = await activateLicence(f.env, { key: f.key, installation: INSTALLATION });
  assert.equal(result.outcome, 'activated', JSON.stringify(result));
  return result;
}

async function secretFile(f, activationId) {
  return JSON.parse(await readFile(join(f.directory, `${activationId}.secret`), 'utf8'));
}

test('without an activation the core asks the hub nothing (I1)', async (t) => {
  const f = await licenceSetup(t);
  assert.deepEqual(await refreshDueLicences(f.env), []);
  assert.equal(await updateLicenceRevocations(f.env), null);
  const stop = new AbortController();
  const lines = [];
  const diagnostics = new DiagnosticLogger(
    new Writable({ write: (chunk, _, done) => (lines.push(String(chunk)), done()) }),
    () => new Date().toISOString(),
  );
  const loop = runLicences({
    databaseUrl: f.url,
    configuration: f.configuration,
    coreVersion: '1.2.3',
    stop: stop.signal,
    diagnostics,
    intervalMs: 20,
    environment: f.env,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  stop.abort();
  await loop;
  assert.equal(f.hub.requests.length, 0, 'the free core never contacts the hub');
  assert.deepEqual(lines, []);
  const overview = await licenceOverview(f.env);
  assert.deepEqual(overview.licences, []);
  const view = await createLicenseService(f.env).view('dedup');
  assert.equal(view.state, 'none');
});

test('activation sends exactly the fields of R2 and keeps the key nowhere', async (t) => {
  const f = await licenceSetup(t);
  const result = await activated(f);
  const [call] = hubCalls(f.hub, 'activate');
  assert.deepEqual(Object.keys(call.body).sort(), ACTIVATE_FIELDS);
  assert.equal(call.body.key, f.key);
  assert.equal(call.body.installId, INSTALLATION);
  assert.equal(call.body.coreVersion, '1.2.3');
  assert.deepEqual(call.body.modules, [{ id: 'paid-store', version: '1.0.0' }]);
  assert.match(call.body.requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(call.body.nonce, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.equal(JSON.stringify(call.body).includes('licensee'), false);

  const stored = await secretFile(f, result.activationId);
  assert.deepEqual(Object.keys(stored).sort(), ['activationId', 'format', 'secret', 'seq']);
  assert.equal(stored.seq, 1);
  if (process.platform !== 'win32')
    assert.equal(
      (await stat(join(f.directory, `${result.activationId}.secret`))).mode & 0o777,
      0o600,
    );
  // Neither the key nor the secret is in any licence table, which backups export.
  const tables = exportedTables.filter((table) => table.name.startsWith('arkvory_license'));
  assert.deepEqual(tables.map((table) => table.name).sort(), [
    'arkvory_license_activations',
    'arkvory_license_clock',
    'arkvory_license_revocations',
  ]);
  for (const table of [...tables.map((x) => x.name), 'arkvory_license_requests']) {
    const rows = JSON.stringify((await f.pool.query(`SELECT * FROM ${table}`)).rows);
    assert.equal(rows.includes(stored.secret), false, table);
    assert.equal(rows.includes(f.key), false, table);
  }
  const overview = await licenceOverview(f.env);
  assert.equal(overview.licences[0].status.state, 'valid');
  assert.deepEqual(overview.licences[0].features, ['dedup', 'delta']);
  const service = createLicenseService(f.env);
  const view = await service.view('dedup');
  assert.equal(view.state, 'valid');
  assert.equal(view.licenseType, 'standard');
  assert.equal(view.activation, 'online');
  assert.equal(JSON.stringify(view).includes(stored.secret), false);
  const evidence = await service.evidence();
  const token = (await f.pool.query('SELECT token FROM arkvory_license_activations')).rows[0].token;
  assert.equal(
    new TextDecoder().decode(evidence[0].document),
    token,
    'evidence is the exact document',
  );
  assert.equal((await service.view('unknown-feature')).state, 'none');
});

test('refresh rotates the secret, sends exactly the fields of R2 and never the key', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  const before = await secretFile(f, activationId);
  const result = await refreshLicence(f.env, activationId);
  assert.equal(result.outcome, 'refreshed', JSON.stringify(result));
  const [call] = hubCalls(f.hub, 'refresh');
  assert.deepEqual(Object.keys(call.body).sort(), REFRESH_FIELDS);
  assert.equal(call.body.activationSecret, before.secret);
  assert.equal(call.body.seq, 1);
  assert.equal(JSON.stringify(call.body).includes(f.key), false);
  const after = await secretFile(f, activationId);
  assert.notEqual(after.secret, before.secret);
  assert.equal(after.seq, 2);
  assert.equal(result.seq, 2);
});

test('a lost answer is repeated with the same nonce inside the hub window', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  f.hub.next.push('drop');
  const result = await refreshLicence(f.env, activationId);
  assert.equal(result.outcome, 'refreshed', JSON.stringify(result));
  const calls = hubCalls(f.hub, 'refresh');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.nonce, calls[0].body.nonce);
  assert.equal(calls[1].body.activationSecret, calls[0].body.activationSecret);
  assert.equal(f.hub.activations.get(activationId).state, 'active', 'no clone was suspected');
  assert.equal((await refreshLicence(f.env, activationId)).outcome, 'refreshed');
});

test('a replayed or foreign answer is refused; the rotated secret is kept', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  const old = (await f.pool.query('SELECT token FROM arkvory_license_activations')).rows[0].token;
  // An answer over TLS with an old token: the hub has rotated, the document is a replay.
  f.hub.next.push({
    status: 200,
    body: { token: old, activationSecret: 'S'.repeat(43), activationId },
  });
  const replay = await refreshLicence(f.env, activationId);
  assert.equal(replay.outcome, 'failed');
  assert.equal(replay.code, 'answer_invalid');
  assert.equal((await secretFile(f, activationId)).secret, 'S'.repeat(43));
  // A signed token of this request, seq and activation, but bound to another installation.
  const nonce = 'FixedRefreshNonce001';
  const licenceId = [...f.hub.licences.values()][0].licenceId;
  const foreign = f.authority.token({
    activationId,
    licenceId,
    nonce,
    seq: 7,
    installation: 'other-install-1',
  });
  f.hub.next.push({
    status: 200,
    body: { token: foreign, activationSecret: 'T'.repeat(43), activationId },
  });
  const moved = await refreshLicence({ ...f.env, nonce: () => nonce }, activationId);
  assert.equal(moved.code, 'answer_invalid');
  assert.equal((await secretFile(f, activationId)).secret, 'T'.repeat(43));
  assert.equal(
    (await licenceOverview(f.env)).licences[0].status.state,
    'valid',
    'the kept token stays',
  );
  // An unsigned refusal revokes nothing and is not retried until an administrator acts.
  f.hub.next.push({ status: 403, body: { code: 'licence_expired', message: 'x', details: {} } });
  const refusal = await refreshLicence(f.env, activationId);
  assert.equal(refusal.outcome, 'refused');
  assert.equal(refusal.nextAttemptAt, null);
  const overview = await licenceOverview(f.env);
  assert.equal(overview.licences[0].status.state, 'valid');
  assert.equal(overview.licences[0].status.reason, 'licence_expired');
  assert.equal(overview.licences[0].nextAttemptAt, null);
  // A token not above the kept seq never replaces the kept one.
  const row = (await f.pool.query('SELECT seq FROM arkvory_license_activations')).rows[0];
  assert.equal(Number(row.seq), 1);
});

test('a signed revocation revokes at once and blocks every earlier token', async (t) => {
  const f = await licenceSetup(t);
  const { activationId, licenceId } = await activated(f);
  const token = (await f.pool.query('SELECT token FROM arkvory_license_activations')).rows[0].token;
  [...f.hub.licences.values()][0].state = 'revoked';
  const result = await refreshLicence(f.env, activationId);
  assert.deepEqual(result, {
    outcome: 'revoked',
    activationId,
    licenceId,
    reason: 'licence_revoked',
  });
  const view = await createLicenseService(f.env).view('dedup');
  assert.equal(view.state, 'revoked');
  assert.equal(view.reason, 'licence_revoked');
  const stale = await f.env.store.saveToken({
    activationId,
    licenceId,
    installation: INSTALLATION,
    activation: 'online',
    token,
    seq: 1,
    issuedAt: Date.now(),
    refreshAfter: Date.now(),
    notAfter: Date.now() + DAY,
    nextAttemptAt: null,
  });
  assert.equal(stale, 'stale');
  assert.equal((await refreshLicence(f.env, activationId)).code, 'license_revoked');
  assert.equal(hubCalls(f.hub, 'refresh').length, 1, 'a revoked activation is not refreshed');
});

test('a reused secret suspends the activation as a clone; a lapsed one comes back', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  const path = join(f.directory, `${activationId}.secret`);
  const copy = await readFile(path, 'utf8');
  assert.equal((await refreshLicence(f.env, activationId)).outcome, 'refreshed');
  // A copy of the installation still holds the retired secret.
  await writeFile(path, copy, { mode: 0o600 });
  const clone = await refreshLicence(f.env, activationId);
  assert.equal(clone.code, 'activation_secret_reused');
  assert.equal(clone.nextAttemptAt, null);
  assert.equal(f.hub.activations.get(activationId).state, 'suspended');

  const g = await licenceSetup(t);
  const lapsed = await activated(g);
  g.hub.activations.get(lapsed.activationId).state = 'lapsed';
  const restored = await refreshLicence(g.env, lapsed.activationId);
  assert.equal(restored.outcome, 'refreshed', 'a lapsed activation takes its place back');
  g.hub.activations.get(lapsed.activationId).state = 'lapsed';
  g.hub.activations.set('other', {
    id: 'other',
    licence: [...g.hub.licences.values()][0],
    state: 'active',
  });
  const full = await refreshLicence(g.env, lapsed.activationId);
  assert.equal(full.code, 'activation_lapsed');
});

test('a hub outage is retried with a growing pause; the token carries on, then ends', async (t) => {
  const f = await licenceSetup(t);
  // Issued two days ago: refresh is overdue by more than a day.
  f.hub.issuedAtMs = () => Date.now() - 2 * DAY - 60 * 60_000;
  const { activationId } = await activated(f);
  await f.hub.close();
  const before = Date.now();
  const failed = await refreshLicence(f.env, activationId);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.code, 'unreachable');
  const pause = failed.nextAttemptAt - before;
  assert.ok(pause >= 11 * 60_000 && pause <= 19 * 60_000, `first pause ${pause} ms`);
  const view = await createLicenseService(f.env).view();
  assert.equal(view.state, 'offline-grace');
  assert.equal(view.refreshFailing, true);
  assert.equal(view.reason, 'unreachable');
  const second = await refreshLicence(f.env, activationId);
  assert.ok(second.nextAttemptAt - Date.now() >= 23 * 60_000, 'the pause grows');

  const g = await licenceSetup(t);
  g.hub.issuedAtMs = () => Date.now() - 31 * DAY;
  await activated(g);
  const expired = await createLicenseService(g.env).view('dedup');
  assert.equal(expired.state, 'expired');
  assert.equal(expired.reason, 'activation_stale');
});

test('setting the clock back does not extend a token', async (t) => {
  const f = await licenceSetup(t);
  await activated(f);
  await f.env.store.observe(INSTALLATION);
  // The writer once saw a time 40 days ahead: today's clock is behind it.
  await f.pool.query("UPDATE arkvory_license_clock SET max_seen_at = now() + interval '40 days'");
  const overview = await licenceOverview(f.env);
  assert.equal(overview.clockRollback, true);
  assert.ok(overview.effectiveTime > Date.now() + 39 * DAY);
  assert.equal(overview.licences[0].status.state, 'expired');
});

test('a token of another installation is a mismatch with grace from discovery', async (t) => {
  const f = await licenceSetup(t);
  await activated(f);
  await f.env.store.observe('9d1c0a2b-0000-4000-8000-123456789abc');
  const view = await createLicenseService(f.env).view('dedup');
  assert.equal(view.state, 'mismatch');
  assert.equal(view.reason, 'installation_mismatch');
  assert.ok(Date.parse(view.graceUntil) > Date.now() + 29 * DAY);
  await f.env.store.observe(INSTALLATION);
  assert.equal((await createLicenseService(f.env).view('dedup')).state, 'valid');
});

test('offline activation answers its own request only, once', async (t) => {
  const f = await licenceSetup(t);
  const request = await createOfflineRequest(f.env, {
    keySha256: licenceKeyDigest(f.key),
    installation: INSTALLATION,
  });
  assert.equal(JSON.stringify(request).includes(f.key), false);
  assert.equal(request.keySha256, licenceKeyDigest(f.key));
  assert.equal((await createLicenseService(f.env).view()).state, 'pending');
  const issued = Date.now() - DAY;
  const answer = f.authority.offlineToken({
    issuedAtMs: issued,
    nonce: request.nonce,
    installation: INSTALLATION,
    type: 'enterprise',
    notAfter: iso(issued + 300 * DAY),
    licenceNotAfter: null,
  });
  const foreign = await installLicenceDocument(f.env, answer, 'another-installation-id');
  assert.equal(foreign.code, 'installation_mismatch');
  const installed = await installLicenceDocument(f.env, answer, INSTALLATION);
  assert.equal(installed.outcome, 'installed', JSON.stringify(installed));
  const view = await createLicenseService(f.env).view('dedup');
  assert.equal(view.state, 'valid');
  assert.equal(view.activation, 'offline');
  assert.equal((await installLicenceDocument(f.env, answer, INSTALLATION)).code, 'nonce_unknown');
  const unrequested = f.authority.offlineToken({
    nonce: 'NoRequestEverMadeX',
    installation: INSTALLATION,
  });
  assert.equal(
    (await installLicenceDocument(f.env, unrequested, INSTALLATION)).code,
    'nonce_unknown',
  );
  assert.equal(f.hub.requests.length, 0, 'offline activation never uses the network');
  assert.equal((await refreshLicence(f.env, installed.activationId)).code, 'offline_activation');
});

test('licence revocation lists: newer only, from a file or the hub, and they revoke', async (t) => {
  const f = await licenceSetup(t);
  const { licenceId } = await activated(f);
  const list = f.authority.revocationList({
    number: 2,
    licences: [{ licenceId, reason: 'refund' }],
  });
  assert.deepEqual(await installLicenceDocument(f.env, list, INSTALLATION), {
    outcome: 'list',
    number: 2,
    changed: true,
  });
  const view = await createLicenseService(f.env).view('dedup');
  assert.equal(view.state, 'revoked');
  const older = f.authority.revocationList({ number: 1 });
  assert.equal(
    (await installLicenceDocument(f.env, older, INSTALLATION)).code,
    'revocation_rollback',
  );
  const conflicting = f.authority.revocationList({ number: 2 });
  assert.equal(
    (await installLicenceDocument(f.env, conflicting, INSTALLATION)).code,
    'revocation_conflict',
  );
  f.hub.revocationList = f.authority.revocationList({
    number: 3,
    certificates: [f.authority.online.id],
  });
  assert.equal((await updateLicenceRevocations(f.env)).number, 3);
  const [call] = hubCalls(f.hub, 'revocations');
  assert.equal(call.query, '?after=2');
  const unsigned = f.authority.revocationList({ number: 4 }, f.authority.online);
  assert.match((await installLicenceDocument(f.env, unsigned, INSTALLATION)).code, /^signature_/);
});

test('deactivation frees the place and deletes the secret', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  const result = await deactivateLicence(f.env, activationId);
  assert.deepEqual(result, { outcome: 'released', activationId });
  assert.deepEqual(Object.keys(hubCalls(f.hub, 'deactivate')[0].body).sort(), [
    'activationId',
    'activationSecret',
  ]);
  await assert.rejects(stat(join(f.directory, `${activationId}.secret`)), { code: 'ENOENT' });
  assert.deepEqual((await licenceOverview(f.env)).licences, []);
  assert.equal(f.hub.activations.get(activationId).state, 'released');
});

test('the scheduler refreshes what is due and logs no secret', async (t) => {
  const f = await licenceSetup(t);
  const { activationId } = await activated(f);
  await f.pool.query(
    "UPDATE arkvory_license_activations SET next_attempt_at = now() - interval '1 minute'",
  );
  const lines = [];
  const diagnostics = new DiagnosticLogger(
    new Writable({ write: (chunk, _, done) => (lines.push(String(chunk)), done()) }),
    () => new Date().toISOString(),
  );
  const stop = new AbortController();
  const loop = runLicences({
    databaseUrl: f.url,
    configuration: f.configuration,
    coreVersion: '1.2.3',
    stop: stop.signal,
    diagnostics,
    intervalMs: 50,
    environment: f.env,
  });
  const done = () =>
    lines.some((l) => l.includes('license.refreshed')) && hubCalls(f.hub, 'revocations').length > 0;
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  stop.abort();
  await loop;
  const log = lines.join('');
  assert.match(log, /"code":"license\.refreshed"/);
  assert.match(log, new RegExp(`"activation":"${activationId}"`));
  const secret = (await secretFile(f, activationId)).secret;
  for (const hidden of [secret, f.key, 'wm', 'token'])
    assert.equal(log.includes(hidden), false, `${hidden} is not in the log`);
  assert.equal(hubCalls(f.hub, 'refresh').length, 1, 'refreshed once, then not due');
  const clock = (await f.pool.query('SELECT installation FROM arkvory_license_clock')).rows[0];
  assert.equal(clock.installation, INSTALLATION);
  assert.equal(hubCalls(f.hub, 'revocations').length, 1);
});

test('activation refuses an answer for another installation or request', async (t) => {
  const f = await licenceSetup(t);
  f.hub.licence(f.key);
  const foreign = f.authority.token({
    installation: 'someone-elses-install',
    nonce: 'q2vYgM3xT0yJ7bFhK9wNcA',
  });
  f.hub.next.push({
    status: 200,
    body: {
      token: foreign,
      activationSecret: 'S'.repeat(43),
      activationId: JSON.parse(Buffer.from(JSON.parse(foreign).payload, 'base64url')).activationId,
    },
  });
  const result = await activateLicence(f.env, { key: f.key, installation: INSTALLATION });
  assert.equal(result.code, 'installation_mismatch');
  const wrongNonce = f.authority.token({
    installation: INSTALLATION,
    nonce: 'AnotherRequestNonce1',
  });
  const id = JSON.parse(Buffer.from(JSON.parse(wrongNonce).payload, 'base64url')).activationId;
  f.hub.next.push({
    status: 200,
    body: { token: wrongNonce, activationSecret: 'S'.repeat(43), activationId: id },
  });
  assert.equal(
    (await activateLicence(f.env, { key: f.key, installation: INSTALLATION })).code,
    'nonce_mismatch',
  );
  f.hub.next.push({
    status: 200,
    body: { token: newId('tok'), activationSecret: 'S'.repeat(43), activationId: id },
  });
  assert.match(
    (await activateLicence(f.env, { key: f.key, installation: INSTALLATION })).code,
    /^answer_invalid/,
  );
  assert.deepEqual((await licenceOverview(f.env)).licences, [], 'nothing was kept');
  f.hub.next.push({
    status: 409,
    body: { code: 'activation_limit_reached', message: 'x', details: {} },
  });
  assert.equal(
    (await activateLicence(f.env, { key: f.key, installation: INSTALLATION })).code,
    'activation_limit_reached',
  );
});

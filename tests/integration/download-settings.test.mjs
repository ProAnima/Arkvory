import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.mjs';

const URL = '/api/v1/system/downloads/settings';

test('download queue settings change without a restart, revision-protected, administrators only', async (t) => {
  const f = await setup(t);
  const call = (method, headers, payload) =>
    f.app.inject({ method, url: URL, headers, ...(payload === undefined ? {} : { payload }) });
  const first = await call('GET', f.headers);
  assert.equal(first.statusCode, 200, first.body);
  const initial = first.json();
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.overrides, {});
  assert.deepEqual(initial.effective, initial.defaults);
  assert.equal(initial.updatedBy, null);
  assert.equal(initial.admission, 'sessions');
  assert.equal(initial.problem, null);
  assert.equal((await call('GET', f.readerHeaders)).statusCode, 403);
  assert.equal(
    (await call('PUT', f.readerHeaders, { expectedRevision: 0, overrides: {} })).statusCode,
    403,
  );
  const saved = await call('PUT', f.headers, {
    expectedRevision: 0,
    overrides: { sessions: 3, strategy: 'smallest-first', idleSeconds: 10 },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().revision, 1);
  assert.equal(saved.json().effective.sessions, 3);
  assert.equal(saved.json().effective.reserve, 0, 'three sessions leave no place to reserve');
  assert.equal(saved.json().defaults.sessions, initial.defaults.sessions);
  assert.ok(saved.json().updatedAt);
  // The running queue took it: topology shows what the scheduler uses now.
  const topology = (
    await f.app.inject({ url: '/api/v1/system/topology', headers: f.headers })
  ).json();
  assert.equal(topology.downloads.sessions, 3);
  assert.equal(topology.downloads.strategy, 'smallest-first');
  const stale = await call('PUT', f.headers, { expectedRevision: 0, overrides: {} });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().reason, 'revision_mismatch');
  for (const [payload, field] of [
    [{ expectedRevision: 1, overrides: { sessions: 2, reserve: 2 } }, '/overrides'],
    [{ expectedRevision: 1, overrides: { slots: 2 } }, '/overrides/slots'],
    [{ expectedRevision: 1, overrides: { sessions: 2000 } }, '/overrides/sessions'],
    [{ expectedRevision: 1 }, '/overrides'],
    [{ overrides: {} }, '/expectedRevision'],
    [{ expectedRevision: 1, overrides: {}, force: true }, '/force'],
  ]) {
    const refused = await call('PUT', f.headers, payload);
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
    assert.ok(
      refused.json().details.some((detail) => detail.field === field),
      `${field} in ${refused.body}`,
    );
  }
  // Back to the environment: empty overrides.
  const reset = await call('PUT', f.headers, { expectedRevision: 1, overrides: {} });
  assert.equal(reset.statusCode, 200);
  assert.deepEqual(reset.json().effective, initial.defaults);
});

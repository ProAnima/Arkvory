import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LICENCE_DAY,
  bestLicence,
  effectiveLicenceTime,
  licenceClockRolledBack,
  licenceRefreshAt,
  licenceRetryDelay,
  licenceRetryable,
  licenceStatus,
} from '../packages/domain/dist/index.js';

const DAY = LICENCE_DAY;
const T = Date.UTC(2026, 9, 18);
const token = (fields = {}) => ({
  licenceId: 'lic_A',
  type: 'standard',
  installation: 'install-1',
  features: ['dedup'],
  issuedAt: T,
  refreshAfter: T + DAY,
  notAfter: T + 30 * DAY,
  licenceNotAfter: T + 365 * DAY,
  graceDays: 30,
  activation: 'online',
  ...fields,
});
const facts = (fields = {}) => ({
  token: token(),
  invalid: null,
  revoked: null,
  failure: null,
  lastRefreshAt: T,
  mismatchSince: null,
  ...fields,
});
const state = (f, now, installation = 'install-1') => licenceStatus(f, installation, now);

test('a valid token, a failing refresh and the offline window (R3 table)', () => {
  assert.equal(state(facts(), T + 1000).state, 'valid');
  const failing = facts({ failure: 'unreachable' });
  assert.deepEqual(
    [state(failing, T + 1000).refreshFailing, state(failing, T + DAY + 1000).refreshFailing],
    [false, true],
    'refreshFailing only after refreshAfter',
  );
  assert.equal(state(failing, T + DAY + 1000).state, 'valid');
  const grace = state(failing, T + 2 * DAY + 1);
  assert.equal(grace.state, 'offline-grace');
  assert.equal(grace.offlineGraceUntil, T + 30 * DAY);
  const stale = state(failing, T + 30 * DAY);
  assert.deepEqual([stale.state, stale.reason], ['expired', 'activation_stale']);
});

test('licence end: renewal grace, then expired; a trial has no grace', () => {
  const ending = facts({
    token: token({
      licenceNotAfter: T + 10 * DAY,
      notAfter: T + 30 * DAY,
      refreshAfter: T + 12 * DAY,
    }),
  });
  const grace = state(ending, T + 11 * DAY);
  assert.deepEqual([grace.state, grace.graceUntil], ['grace', T + 40 * DAY]);
  const trial = facts({
    token: token({
      type: 'trial',
      graceDays: 0,
      licenceNotAfter: T + 5 * DAY,
      notAfter: T + 5 * DAY,
    }),
  });
  assert.deepEqual(
    [state(trial, T + 5 * DAY).state, state(trial, T + 5 * DAY).reason],
    ['expired', 'trial_expired'],
  );
  const ended = facts({ token: token({ licenceNotAfter: T, graceDays: 0, notAfter: T + DAY }) });
  assert.equal(state(ended, T + DAY).reason, 'licence_expired');
  const perpetual = facts({ token: token({ licenceNotAfter: null }) });
  assert.equal(state(perpetual, T + 2000).notAfter, null);
});

test('revocation, mismatch and invalid documents come first', () => {
  assert.equal(state(facts({ revoked: 'licence_revoked' }), T).state, 'revoked');
  const moved = state(facts({ mismatchSince: T + DAY }), T + 2 * DAY, 'install-2');
  assert.deepEqual([moved.state, moved.graceUntil], ['mismatch', T + 31 * DAY]);
  assert.equal(state(facts(), T, null).state, 'valid', 'no mismatch before the id is recorded');
  assert.deepEqual(
    state(facts({ token: null, invalid: 'document_signature' }), T).state,
    'invalid',
  );
  const offline = facts({ token: token({ activation: 'offline' }), failure: null });
  assert.equal(state(offline, T + 20 * DAY).state, 'valid', 'offline activations have no refresh');
});

test('effective time never goes back; a day behind is a rollback', () => {
  assert.equal(effectiveLicenceTime(T, T + DAY, T - DAY), T + DAY);
  assert.equal(effectiveLicenceTime(T, null, T + 5), T + 5);
  assert.equal(effectiveLicenceTime(T, null, null), T);
  assert.equal(licenceClockRolledBack(T, T + DAY + 1), true);
  assert.equal(licenceClockRolledBack(T, T + DAY), false);
  assert.equal(licenceClockRolledBack(T, null), false);
});

test('retries: 15 minutes doubling to 6 hours, spread, Retry-After; 4xx waits for a person', () => {
  const minute = 60_000;
  assert.equal(licenceRetryDelay(1, 0.5), 15 * minute);
  assert.equal(licenceRetryDelay(2, 0.5), 30 * minute);
  assert.equal(licenceRetryDelay(20, 0.5), 6 * 60 * minute);
  assert.equal(licenceRetryDelay(1, 0), 12 * minute);
  assert.equal(licenceRetryDelay(1, 0.999999), Math.round(15 * minute * (0.8 + 0.4 * 0.999999)));
  assert.equal(licenceRetryDelay(1, 0.5, 60 * minute), 60 * minute);
  for (const code of ['unreachable', 'timeout', 'tls_failed', 'hub_error', 'rate_limited'])
    assert.equal(licenceRetryable(code), true, code);
  for (const code of [
    'licence_expired',
    'activation_secret_reused',
    'activation_recovery_required',
    'activation_lapsed',
    'secret_missing',
  ])
    assert.equal(licenceRetryable(code), false, code);
  assert.equal(licenceRefreshAt(T, 0), T);
  assert.ok(licenceRefreshAt(T, 0.99) < T + 60 * minute);
});

test('the best licence carries the feature asked for', () => {
  const licences = [
    { status: state(facts({ revoked: 'x' }), T), features: ['dedup'] },
    { status: state(facts(), T), features: ['delta'] },
    { status: state(facts(), T), features: ['dedup'] },
  ];
  assert.equal(bestLicence(licences, 'dedup'), 2);
  assert.equal(bestLicence(licences, 'delta'), 1);
  assert.equal(bestLicence(licences), 1);
  assert.equal(bestLicence([], 'dedup'), -1);
});

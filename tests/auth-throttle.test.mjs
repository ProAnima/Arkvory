import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_LOGIN_BACKOFF, drainedLoginDebt, loginBackoffMs } from '@proanima/arkvory-domain';
import { AuthThrottle, TokenBuckets, clientKey } from '../apps/api/dist/auth-throttle.js';
import { parseTrustedProxies } from '../apps/api/dist/config.js';
import {
  applyRegistrationOption,
  registrationEnabled,
  tokenLifetime,
  tokenRequest,
  tokenScopeChoice,
  tokenState,
} from '../apps/web/dist/user-token-model.js';

test('account backoff drains continuously, starts above the threshold and stays capped', () => {
  const { threshold, drainMs, maxDelayMs } = ACCOUNT_LOGIN_BACKOFF;
  assert.equal(loginBackoffMs(threshold), 0);
  assert.equal(loginBackoffMs(threshold + 1), 1000);
  assert.equal(loginBackoffMs(threshold + 3), 4000);
  assert.equal(loginBackoffMs(threshold + 40), maxDelayMs);
  assert.ok(maxDelayMs <= 5 * 60 * 1000, 'a third party can only delay the owner for minutes');
  assert.equal(drainedLoginDebt(10, 5 * drainMs), 5);
  assert.equal(drainedLoginDebt(10, Number.POSITIVE_INFINITY), 0);
  assert.equal(drainedLoginDebt(Number.NaN, 0), 0);
  // One address at its sustained login rate never accumulates enough debt for a backoff,
  // even when two writer processes each admit it independently.
  let debt = 0;
  for (let burst = 0; burst < 2 * 10; burst++) debt = drainedLoginDebt(debt, 0) + 1;
  assert.equal(loginBackoffMs(debt), 0, 'both processes spend the full burst at once');
  for (let attempt = 0; attempt < 1000; attempt++) {
    debt = drainedLoginDebt(debt, 15_000 / 2) + 1;
    assert.equal(loginBackoffMs(debt), 0, `steady single-address debt ${debt}`);
  }
});

test('token buckets refuse without cost, refund successes and bound their memory', () => {
  let clock = 0;
  const buckets = new TokenBuckets({ capacity: 2, refillMs: 10_000 }, () => clock, 3);
  assert.equal(buckets.take('a'), 0);
  assert.equal(buckets.take('a'), 0);
  assert.equal(buckets.take('a'), 10);
  assert.equal(buckets.take('a'), 10, 'a refused request must not extend the wait');
  clock = 5_000;
  assert.equal(buckets.take('a'), 5);
  buckets.refund('a');
  assert.equal(buckets.take('a'), 0);
  for (const key of ['b', 'c', 'd', 'e']) buckets.take(key);
  assert.equal(buckets.size, 3);
});

test('auth throttle limits login per address and registration per address and in total', () => {
  let clock = 0;
  const throttle = new AuthThrottle(() => clock);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal(throttle.admitLogin('x'), 0);
  assert.ok(throttle.admitLogin('x') > 0);
  assert.equal(throttle.admitLogin('y'), 0, 'other addresses keep their own budget');
  throttle.loginSucceeded('x');
  assert.equal(throttle.admitLogin('x'), 0, 'a correct password returns its token');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(throttle.admitRegistration('r'), 0);
  assert.ok(throttle.admitRegistration('r') > 0);
  let admitted = 3;
  for (let address = 0; address < 40; address++)
    if (throttle.admitRegistration(`a${address}`) === 0) admitted++;
  assert.equal(admitted, 20, 'distributed sign-ups share one global budget');
  clock += 3 * 60_000;
  assert.equal(throttle.admitRegistration('late'), 0);
});

test('client keys group IPv6 by /64 and unwrap IPv4-mapped addresses', () => {
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(clientKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(clientKey('::1'), '0:0:0:0::/64');
});

test('trusted proxies accept exact addresses and CIDR ranges only', () => {
  assert.deepEqual(parseTrustedProxies(undefined), []);
  assert.deepEqual(parseTrustedProxies(' 10.0.0.1, 192.168.0.0/16 ,::1/128'), [
    '10.0.0.1',
    '192.168.0.0/16',
    '::1/128',
  ]);
  for (const value of ['proxy.local', '10.0.0.0/33', '10.0.0.1/8/1', '*', '::1/129'])
    assert.throws(() => parseTrustedProxies(value), /ARKVORY_TRUSTED_PROXIES/);
});

test('console token form defaults to 90 days and read-only, and sign-up hides by default', async () => {
  const now = Date.parse('2026-10-01T00:00:00.000Z');
  assert.equal(tokenLifetime('7'), 90);
  assert.equal(tokenLifetime('365'), 365);
  assert.equal(tokenScopeChoice('admin'), 'read');
  assert.deepEqual(tokenRequest(90, 'read', now), { scope: 'read' });
  assert.deepEqual(tokenRequest(30, 'read-write', now), {
    scope: 'read-write',
    expiresAt: '2026-10-31T00:00:00.000Z',
  });
  const token = { revoked: false, expiresAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(tokenState(token, now), 'expired');
  assert.equal(tokenState({ ...token, expiresAt: '2027-01-01T00:00:00.000Z' }, now), 'active');
  assert.equal(tokenState({ ...token, revoked: true }, now), 'revoked');
  const controls = {
    toggle: { hidden: false },
    register: { hidden: false },
    login: { hidden: true },
  };
  applyRegistrationOption(false, controls);
  assert.deepEqual(controls, {
    toggle: { hidden: true },
    register: { hidden: true },
    login: { hidden: false },
  });
  applyRegistrationOption(true, controls);
  assert.equal(controls.toggle.hidden, false);
  assert.equal(await registrationEnabled(async () => ({ selfRegistration: true })), true);
  assert.equal(
    await registrationEnabled(async () => {
      throw new Error('older server');
    }),
    false,
  );
});

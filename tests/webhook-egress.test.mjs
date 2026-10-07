import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookFailure } from '@proanima/arkvory-application';
import { createEgressPolicy, resolveReceiver } from '@proanima/arkvory-infrastructure';

const open = createEgressPolicy([]);

test('public addresses pass; loopback, private, link-local, metadata and reserved ranges do not', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '1.1.1.1'])
    assert.equal(open.permits(address, 4), true, address);
  for (const address of [
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
  ])
    assert.equal(open.permits(address, 4), false, address);
  assert.equal(open.permits('172.32.0.1', 4), true, 'just outside 172.16.0.0/12');
  for (const address of [
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '2001:db8::1',
  ])
    assert.equal(open.permits(address, 6), false, address);
  assert.equal(open.permits('2606:4700:4700::1111', 6), true);
});

test('the operator allowlist opens exactly its networks and nothing around them', () => {
  const policy = createEgressPolicy(['10.20.0.0/16', 'fd12::/16']);
  assert.equal(policy.permits('10.20.5.9', 4), true);
  assert.equal(policy.permits('10.21.0.1', 4), false);
  assert.equal(policy.permits('10.19.255.255', 4), false);
  assert.equal(policy.permits('169.254.169.254', 4), false, 'metadata stays closed');
  assert.equal(policy.permits('fd12::5', 6), true);
  assert.equal(policy.permits('fd13::5', 6), false);
});

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WebhookFailure, String(error));
    return error.code;
  }
  return 'resolved';
}

test('one blocked record refuses the whole name, so a mixed answer cannot pick the internal address', async () => {
  const mixed = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ];
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://hook.example/'), open, mixed)),
    'blocked',
  );
  const publicOnly = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.deepEqual(await resolveReceiver(new URL('https://hook.example/'), open, publicOnly), {
    address: '93.184.216.34',
    family: 4,
  });
});

test('an IP literal is checked without a lookup, and a name that does not resolve is a network failure', async () => {
  const never = async () => {
    throw new Error('the resolver must not be called for a literal');
  };
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://127.0.0.1/'), open, never)),
    'blocked',
  );
  assert.equal(await failureOf(resolveReceiver(new URL('https://[::1]/'), open, never)), 'blocked');
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://169.254.169.254/latest'), open, never)),
    'blocked',
  );
  assert.equal(
    (await resolveReceiver(new URL('https://93.184.216.34/'), open, never)).address,
    '93.184.216.34',
  );
  const missing = async () => {
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  };
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://gone.example/'), open, missing)),
    'network',
  );
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://empty.example/'), open, async () => [])),
    'network',
  );
});

test('plain HTTP to a loopback host is the one receiver that may stay on the machine', async () => {
  const local = async () => [{ address: '127.0.0.1', family: 4 }];
  assert.equal(
    (await resolveReceiver(new URL('http://localhost:8123/hook'), open, local)).address,
    '127.0.0.1',
  );
  // HTTPS to localhost is an ordinary name: loopback stays blocked unless the operator allows it.
  assert.equal(
    await failureOf(resolveReceiver(new URL('https://localhost/hook'), open, local)),
    'blocked',
  );
  assert.equal(
    (
      await resolveReceiver(
        new URL('https://localhost/hook'),
        createEgressPolicy(['127.0.0.0/8']),
        local,
      )
    ).address,
    '127.0.0.1',
  );
  // A name that is not loopback never gets the exception, even over http.
  assert.equal(
    await failureOf(resolveReceiver(new URL('http://internal.example/'), open, local)),
    'blocked',
  );
});

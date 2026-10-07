import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebhookFailure } from '@proanima/arkvory-application';
import {
  MIN_WEBHOOK_SECRET_BYTES,
  readWebhookSecrets,
  signWebhook,
  verifyWebhook,
} from '@proanima/arkvory-infrastructure';

const secret = 'a-long-random-signing-secret-1';
const body = '{"id":"releases:7","action":"artifact.publish"}';
const now = 1_790_000_000;

test('the signature is sha256 HMAC over "<timestamp>.<body>" in the documented form', () => {
  const expected = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
  assert.equal(signWebhook(secret, now, body), `sha256=${expected}`);
  assert.notEqual(signWebhook(secret, now + 1, body), signWebhook(secret, now, body));
});

test('a delivery verifies with its secret inside the tolerance and with nothing else', () => {
  const input = {
    secrets: [secret],
    timestamp: String(now),
    signature: signWebhook(secret, now, body),
    body,
    nowSeconds: now + 10,
  };
  assert.equal(verifyWebhook(input), true);
  assert.equal(verifyWebhook({ ...input, body: body.replace('7', '8') }), false, 'changed body');
  assert.equal(verifyWebhook({ ...input, secrets: ['another-secret-of-length'] }), false);
  assert.equal(
    verifyWebhook({ ...input, timestamp: String(now + 1) }),
    false,
    'timestamp is signed',
  );
  assert.equal(verifyWebhook({ ...input, signature: 'sha256=00' }), false);
  assert.equal(verifyWebhook({ ...input, signature: '' }), false);
  assert.equal(verifyWebhook({ ...input, timestamp: 'abc' }), false);
});

test('a captured delivery is refused outside five minutes in either direction', () => {
  const input = {
    secrets: [secret],
    timestamp: String(now),
    signature: signWebhook(secret, now, body),
    body,
  };
  assert.equal(verifyWebhook({ ...input, nowSeconds: now + 300 }), true);
  assert.equal(verifyWebhook({ ...input, nowSeconds: now + 301 }), false, 'too old');
  assert.equal(verifyWebhook({ ...input, nowSeconds: now - 301 }), false, 'from the future');
  assert.equal(verifyWebhook({ ...input, nowSeconds: now + 60, toleranceSeconds: 30 }), false);
});

test('during a rotation a delivery carries two signatures and either secret verifies it', () => {
  const next = 'the-next-signing-secret-2026';
  const header = [signWebhook(secret, now, body), signWebhook(next, now, body)].join(',');
  const base = { timestamp: String(now), signature: header, body, nowSeconds: now };
  assert.equal(
    verifyWebhook({ ...base, secrets: [secret] }),
    true,
    'receiver still on the old secret',
  );
  assert.equal(
    verifyWebhook({ ...base, secrets: [next] }),
    true,
    'receiver already on the new secret',
  );
  assert.equal(verifyWebhook({ ...base, secrets: ['unrelated-secret-of-length'] }), false);
});

test('secret files are read trimmed; an unreadable or short secret is a constant failure code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-secret-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const good = join(directory, 'good');
  const short = join(directory, 'short');
  await writeFile(good, `${secret}\n`);
  await writeFile(short, 'x'.repeat(MIN_WEBHOOK_SECRET_BYTES - 1));
  assert.deepEqual(await readWebhookSecrets([good]), [secret]);
  for (const file of [short, join(directory, 'missing')]) {
    const error = await readWebhookSecrets([file]).catch((caught) => caught);
    assert.ok(error instanceof WebhookFailure);
    assert.equal(error.code, 'secret');
    assert.ok(!String(error.message).includes(directory), 'the path never reaches the error');
  }
});

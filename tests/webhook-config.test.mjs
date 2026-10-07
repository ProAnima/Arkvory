import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAllowedNetworks,
  parseWebhookSettings,
  readWebhookSettings,
} from '@proanima/arkvory-infrastructure';

const secret = process.platform === 'win32' ? 'C:\\keys\\hook.secret' : '/etc/arkvory/hook.secret';
const valid = {
  id: 'ci-main',
  repository: 'releases',
  url: 'https://ci.example.com/hooks/arkvory',
  secretFile: secret,
};

test('a subscription needs an id, a repository, an HTTPS receiver and an absolute secret file', () => {
  const [hook] = parseWebhookSettings({ webhooks: [valid] });
  assert.deepEqual(hook, valid);
  const withOptions = parseWebhookSettings({
    webhooks: [{ ...valid, nextSecretFile: secret, actions: ['artifact.publish', 'stage.add'] }],
  });
  assert.deepEqual(withOptions[0].actions, ['artifact.publish', 'stage.add']);
  assert.equal(withOptions[0].nextSecretFile, secret);
  assert.deepEqual(parseWebhookSettings({ webhooks: [] }), []);
});

test('receivers are HTTPS; plain HTTP is accepted for loopback only, never with credentials or a query', () => {
  const bad = (url) =>
    assert.throws(
      () => parseWebhookSettings({ webhooks: [{ ...valid, url }] }),
      /Invalid ARKVORY_WEBHOOKS_FILE: url/,
      url,
    );
  bad('http://ci.example.com/hook');
  bad('ftp://ci.example.com/hook');
  bad('https://user:pass@ci.example.com/hook');
  bad('https://ci.example.com/hook?token=x');
  bad('https://ci.example.com/hook#frag');
  bad('not a url');
  bad(`https://ci.example.com/${'a'.repeat(2100)}`);
  for (const url of [
    'http://localhost:9000/hook',
    'http://127.0.0.1:9000/hook',
    'http://[::1]:9/h',
  ])
    assert.equal(parseWebhookSettings({ webhooks: [{ ...valid, url }] }).length, 1, url);
});

test('unknown fields, bad names, relative files, bad actions and duplicates are refused', () => {
  const refuse = (hook, field) =>
    assert.throws(
      () => parseWebhookSettings({ webhooks: [hook] }),
      new RegExp(`Invalid ARKVORY_WEBHOOKS_FILE: ${field}`),
      field,
    );
  refuse({ ...valid, extra: 1 }, 'unknown field');
  refuse({ ...valid, id: 'Bad Name' }, 'id');
  refuse({ ...valid, id: undefined }, 'id');
  refuse({ ...valid, repository: '../x' }, 'repository');
  refuse({ ...valid, secretFile: 'relative.secret' }, 'secretFile');
  refuse({ ...valid, nextSecretFile: 'relative' }, 'nextSecretFile');
  refuse({ ...valid, actions: [] }, 'actions');
  refuse({ ...valid, actions: ['Artifact Publish'] }, 'actions');
  refuse({ ...valid, actions: ['a.b', 'a.b'] }, 'actions');
  assert.throws(() => parseWebhookSettings({ webhooks: [valid, valid] }), /duplicate id/);
  assert.throws(() => parseWebhookSettings({ other: [] }), /unknown field/);
  assert.throws(() => parseWebhookSettings([]), /document/);
  const many = Array.from({ length: 17 }, (_, index) => ({ ...valid, id: `hook-${index}` }));
  assert.throws(() => parseWebhookSettings({ webhooks: many }), /webhooks/);
  assert.equal(parseWebhookSettings({ webhooks: many.slice(0, 16) }).length, 16);
});

test('the file is optional, but a configured file that cannot be read or parsed stops startup', async (t) => {
  assert.deepEqual(await readWebhookSettings(undefined), []);
  assert.deepEqual(await readWebhookSettings(''), []);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-hooks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(readWebhookSettings(join(directory, 'missing.json')), /cannot be read/);
  const broken = join(directory, 'broken.json');
  await writeFile(broken, '{ nope');
  await assert.rejects(readWebhookSettings(broken), /JSON/);
  const good = join(directory, 'webhooks.json');
  await writeFile(good, JSON.stringify({ webhooks: [valid] }));
  assert.equal((await readWebhookSettings(good)).length, 1);
});

test('allowed networks are CIDR ranges; nothing configured allows nothing', () => {
  assert.deepEqual(parseAllowedNetworks(undefined), []);
  assert.deepEqual(parseAllowedNetworks('  '), []);
  assert.deepEqual(parseAllowedNetworks('10.20.0.0/16, fd00::/8'), ['10.20.0.0/16', 'fd00::/8']);
  for (const bad of [
    '10.0.0.0',
    '10.0.0.0/33',
    'example.com/8',
    '10.0.0.0/8/1',
    '::1/129',
    '10.0.0.0/x',
  ])
    assert.throws(() => parseAllowedNetworks(bad), /ARKVORY_WEBHOOKS_ALLOW_PRIVATE/, bad);
});

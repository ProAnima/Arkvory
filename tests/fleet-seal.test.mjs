import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetSeal, siteOrigin } from '@proanima/arkvory-infrastructure';

test('a sealed site key opens only for its site and only intact', async () => {
  const seal = FleetSeal.fromKey(randomBytes(32));
  const box = seal.seal('site-a', 'afk_secret');
  assert.equal(seal.open('site-a', box), 'afk_secret');
  assert.ok(!box.includes(Buffer.from('afk_secret')), 'the key is not stored in clear');
  assert.throws(() => seal.open('site-b', box), 'moved to another site');
  const tampered = Buffer.from(box);
  tampered[20] ^= 1;
  assert.throws(() => seal.open('site-a', tampered));
  assert.throws(() => FleetSeal.fromKey(randomBytes(32)).open('site-a', box), 'another key');
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-seal-'));
  const hex = join(directory, 'hex.key');
  await writeFile(hex, randomBytes(32).toString('hex') + '\n');
  assert.ok(await FleetSeal.fromFile(hex));
  const short = join(directory, 'short.key');
  await writeFile(short, 'too short');
  await assert.rejects(FleetSeal.fromFile(short), /ARKVORY_FLEET_KEY_FILE/);
});

test('the seal key is made once on first use, also by two processes at once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-seal-'));
  const path = join(directory, 'fleet.key');
  const [first, second] = await Promise.all([
    FleetSeal.loadOrCreate(path),
    FleetSeal.loadOrCreate(path),
  ]);
  const box = first.seal('site', 'afk_secret');
  assert.equal(second.open('site', box), 'afk_secret', 'both processes hold the same key');
  assert.equal((await FleetSeal.loadOrCreate(path)).open('site', box), 'afk_secret');
});

test('a site address is an HTTPS origin, or HTTP on loopback only', () => {
  assert.equal(siteOrigin('https://branch.example:8443/'), 'https://branch.example:8443');
  assert.equal(siteOrigin(' http://127.0.0.1:8080 '), 'http://127.0.0.1:8080');
  for (const wrong of [
    'http://branch.example',
    'https://user:pass@branch.example',
    'https://branch.example/api',
    'https://branch.example/?a=1',
    'ftp://branch.example',
    'not a url',
    42,
  ])
    assert.throws(() => siteOrigin(wrong), { code: 'invalid' });
});

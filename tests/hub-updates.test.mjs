import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubReleases, reportUpdated } from '../apps/deploy/dist/hub.js';
import {
  defaultHub,
  hubSettings,
  hubUrl,
  installId,
  parseHubSettings,
  saveHubSettings,
} from '../apps/deploy/dist/hub-settings.js';
import { ReleaseHttpError } from '../apps/deploy/dist/release-http.js';
import { signRelease } from '../apps/deploy/dist/release-signature.js';
import { chooseRelease } from '../apps/deploy/dist/staging.js';
import { removeTestDirectory } from './helpers.mjs';
import { testKey } from './release-test-key.mjs';

const archive = Buffer.from('runtime archive bytes');
const current = {
  format: 1,
  version: '1.0.0',
  commit: 'a'.repeat(40),
  schema: 28,
  archiveSha256: 'b'.repeat(64),
  setupSha256: 'c'.repeat(64),
};
const next = {
  ...current,
  version: '1.1.0',
  archiveSha256: createHash('sha256').update(archive).digest('hex'),
};

/** The hub's app API on loopback; downloads redirect to a separate "GitHub" path. */
async function fakeHub(t, key, { offer = '1.1.0', manifest = next } = {}) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const files = {
    'arkvory-release.json': manifestBytes,
    'arkvory-release.json.sig': Buffer.from(
      signRelease(manifestBytes, key.pem, key.id, 'timestamp:1\tfile:arkvory-release.json'),
    ),
    'arkvory-runtime.zip': archive,
  };
  const seen = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://hub');
    seen.push({ path: url.pathname, query: url.search, headers: request.headers });
    const update = /^\/v1\/arkvory\/update\/[^/]+\/[^/]+\/([^/]+)$/.exec(url.pathname);
    const download = /^\/v1\/arkvory\/download\/1\.1\.0\/([^/]+)$/.exec(url.pathname);
    const file = /^\/github\/([^/]+)$/.exec(url.pathname);
    if (update && offer && update[1] !== offer) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: offer, platforms: {} }));
    } else if (update) response.writeHead(204).end();
    else if (download) response.writeHead(302, { location: `/github/${download[1]}` }).end();
    else if (file && files[file[1]]) response.writeHead(200).end(files[file[1]]);
    else response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${String(server.address().port)}`;
  return { url, seen, files };
}
const client = (url, id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b') => ({
  settings: { ...defaultHub, url },
  installId: id,
});

test('the hub offers a version; its signed manifest and the archive are verified', async (t) => {
  const key = testKey();
  const hub = await fakeHub(t, key);
  const releases = new HubReleases(client(hub.url), undefined, key.trusted);
  const selected = await releases.resolve(null, current);
  assert.deepEqual(selected.release, next);
  const check = hub.seen.find((entry) => entry.path.includes('/update/'));
  assert.equal(check.query, '?channel=stable');
  assert.equal(check.headers['x-install-id'], '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b');
  assert.match(check.path, /\/1\.0\.0$/);
  for (const entry of hub.seen) assert.equal(entry.headers.authorization, undefined);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-hub-'));
  t.after(() => removeTestDirectory(directory));
  await releases.download(selected.archiveUrl, join(directory, 'a.zip'), next.archiveSha256);
  assert.deepEqual(await readFile(join(directory, 'a.zip')), archive);
  await assert.rejects(
    releases.download(selected.archiveUrl, join(directory, 'b.zip'), 'd'.repeat(64)),
    /checksum/,
  );
  // Without statistics the install sends no id: the hub then offers only full rollouts.
  hub.seen.length = 0;
  await new HubReleases(client(hub.url, null), undefined, key.trusted).resolve(null, current);
  assert.equal(hub.seen[0].headers['x-install-id'], undefined);
});

test('nothing newer, a foreign signature or a mismatched manifest install nothing', async (t) => {
  const key = testKey();
  const quiet = await fakeHub(t, key, { offer: null });
  assert.equal(
    await new HubReleases(client(quiet.url), undefined, key.trusted).resolve(null, current),
    null,
  );
  const hub = await fakeHub(t, key);
  await assert.rejects(
    new HubReleases(client(hub.url), undefined, testKey().trusted).resolve(null, current),
    /unknown key/,
  );
  const lying = await fakeHub(t, key, { manifest: { ...next, version: '1.2.0' } });
  await assert.rejects(
    new HubReleases(client(lying.url), undefined, key.trusted).resolve(null, current),
    /does not match/,
  );
  // An explicit version skips the decision but not the signature.
  const pinned = await new HubReleases(client(hub.url), undefined, key.trusted).resolve(
    '1.1.0',
    current,
  );
  assert.equal(pinned.release.version, '1.1.0');
  assert.ok(!hub.seen.some((entry) => entry.path.includes('/update/') && entry.query === ''));
});

test('GitHub replaces the hub only when the hub cannot be reached', async () => {
  const github = { resolve: async () => ({ release: next, archiveUrl: 'github' }) };
  const failing = (error) => ({
    resolve: async () => {
      throw error;
    },
  });
  for (const error of [
    new ReleaseHttpError(503),
    new TypeError('fetch failed'),
    Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
  ]) {
    const chosen = await chooseRelease(failing(error), async () => github, null, current);
    assert.equal(chosen.from, github, error.message);
  }
  for (const error of [new ReleaseHttpError(404), new Error('Release signature is not valid')]) {
    let asked = false;
    await assert.rejects(
      chooseRelease(
        failing(error),
        async () => {
          asked = true;
          return github;
        },
        null,
        current,
      ),
      (thrown) => thrown === error,
    );
    assert.equal(asked, false, error.message);
  }
  const quiet = { resolve: async () => null };
  assert.equal((await chooseRelease(quiet, async () => github, null, current)).selected, null);
  assert.equal((await chooseRelease(null, async () => github, null, current)).from, github);
});

test('hub settings default to the studio hub and validate every field', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-hub-settings-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'config'));
  assert.deepEqual(await hubSettings(root), defaultHub);
  assert.equal(defaultHub.statistics, true);
  await saveHubSettings(root, { ...defaultHub, url: null, channel: 'beta', statistics: false });
  assert.deepEqual(await hubSettings(root), {
    url: null,
    project: 'arkvory',
    channel: 'beta',
    statistics: false,
  });
  assert.equal(hubUrl('https://hub.example/'), 'https://hub.example');
  assert.equal(hubUrl('http://127.0.0.1:8090'), 'http://127.0.0.1:8090');
  for (const bad of ['http://hub.example', 'https://u:p@hub.example', 'https://hub.example/?a=1'])
    assert.throws(() => hubUrl(bad), /https origin/, bad);
  for (const bad of [
    { ...defaultHub, format: 1, channel: 'nightly' },
    { ...defaultHub, format: 1, project: 'A B' },
    { ...defaultHub, format: 2 },
  ])
    assert.throws(() => parseHubSettings(bad));
  const id = await installId(root);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(await installId(root), id, 'made once and kept');
});

test('an updated event is sent with statistics on and never otherwise', async (t) => {
  const received = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push({ path: request.url, body: JSON.parse(body) });
      response.writeHead(202).end('{"accepted":1}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${String(server.address().port)}`;
  await reportUpdated(client(url), next);
  await reportUpdated(
    { ...client(url), settings: { ...defaultHub, url, statistics: false } },
    next,
  );
  await reportUpdated(client(url, null), next);
  assert.equal(received.length, 1);
  assert.equal(received[0].path, '/v1/arkvory/events');
  assert.equal(received[0].body.version, '1.1.0');
  assert.deepEqual(received[0].body.events, [{ kind: 'updated' }]);
  // A hub that cannot be reached is not an error of the update.
  await reportUpdated(client('http://127.0.0.1:9'), next);
});

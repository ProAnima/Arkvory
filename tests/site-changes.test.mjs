import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pollChanges } from '../apps/deploy/dist/site-changes.js';
import { SiteChangeControl } from '../apps/api/dist/site-change-control.js';
import { readSiteChange } from '../packages/contracts/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';

const key = 'arkvory_' + 'k'.repeat(40);

/** An installation with the updater mailbox of ADR 0038, as updates-connect leaves it. */
async function site(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-site-changes-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'updates/status'), { recursive: true });
  await mkdir(join(root, 'updates/inbox'), { recursive: true });
  await writeFile(
    join(root, 'installation.json'),
    JSON.stringify({
      format: 1,
      mode: 'systemd',
      engine: 'docker',
      automatic: false,
      pin: null,
      current: {
        format: 1,
        version: '1.0.0',
        schema: 17,
        commit: 'a'.repeat(40),
        archiveSha256: 'b'.repeat(64),
        setupSha256: 'c'.repeat(64),
      },
    }),
  );
  return root;
}

/** What the agent would do, recorded; the key file is read while it exists. */
function actions(fail) {
  const calls = [];
  return {
    calls,
    mirror: async (_state, change) => {
      const secret = change.tokenFile ? (await readFile(change.tokenFile, 'utf8')).trim() : null;
      calls.push({ mirror: { ...change, tokenFile: undefined }, secret });
      if (fail) throw new Error(fail);
    },
    switchover: async (node) => {
      calls.push({ switchover: node });
    },
    finishSwitchover: async (node) => {
      calls.push({ finish: node });
      return true;
    },
    singleCopy: async (options) => {
      calls.push({ singleCopy: Object.fromEntries(options) });
    },
  };
}

const attach = readSiteChange({
  kind: 'mirror-attach',
  repository: 'releases',
  upstream: 'https://source.example',
  sourceRepository: 'releases',
  stages: ['tested'],
  certificate: null,
});
const id = (n) => `00000000-0000-4000-8000-00000000000${String(n)}`;

test('a mirror change goes through the mailbox once; its key never stays or shows', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await assert.rejects(api.request(id(1), attach, key, 'admin'), { code: 'unavailable' });
  // The agent's first tick reports in; from then on requests are taken.
  await pollChanges(root, actions());
  assert.equal((await api.status()).agent, true);
  await assert.rejects(api.request(id(1), attach, undefined, 'admin'), { code: 'invalid_input' });
  await assert.rejects(api.request(id(1), attach, 'short', 'admin'), { code: 'invalid_input' });
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  if (process.platform !== 'win32')
    assert.equal((await stat(join(root, 'updates/inbox/change.key'))).mode & 0o777, 0o600);
  const pending = await api.status();
  assert.deepEqual(pending.pending?.id, id(1));
  assert.doesNotMatch(JSON.stringify(pending), new RegExp(key));
  // The same id again is the same request; another one waits for the slot.
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  await assert.rejects(api.request(id(2), attach, key, 'admin'), { code: 'busy' });
  const agent = actions();
  await pollChanges(root, agent);
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].secret, key);
  assert.deepEqual(agent.calls[0].mirror.stages, ['tested']);
  const done = await api.status();
  assert.equal(done.pending, null);
  assert.equal(done.recent[0].state, 'done');
  assert.equal(done.recent[0].actor, 'admin');
  // Nothing of the request or its key is left anywhere.
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), []);
  const files = await readdir(root);
  assert.ok(!files.includes('change.key') && !files.includes('change-request.json'));
  for (const name of ['updates/status/changes.json'])
    assert.doesNotMatch(await readFile(join(root, name), 'utf8'), new RegExp(key));
  // Repeating a finished request does not queue it again.
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  assert.equal((await api.status()).pending, null);
});

test('a failed change is recorded with its reason; an old request expires', async (t) => {
  const root = await site(t);
  let now = Date.parse('2026-10-14T12:00:00Z');
  const api = new SiteChangeControl(join(root, 'updates'), () => now);
  await pollChanges(root, actions(), () => now);
  const detach = readSiteChange({ kind: 'mirror-detach', repositories: ['releases'] });
  await api.request(id(1), detach, undefined, 'admin');
  await pollChanges(root, actions('releases is not a mirrored repository'), () => now);
  const failed = (await api.status()).recent[0];
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /not a mirrored repository/);
  await api.request(id(2), detach, undefined, 'admin');
  now += 6 * 60 * 1000;
  const agent = actions();
  await pollChanges(root, agent, () => now);
  assert.equal(agent.calls.length, 0, 'an expired request is never applied');
  assert.match((await api.status()).recent[0].error, /expired/);
});

test('a switchover the agent did not see end is finished by the next tick', async (t) => {
  const root = await site(t);
  // The agent took the request and was stopped by the move itself.
  await writeFile(
    join(root, 'change-request.json'),
    JSON.stringify({
      id: id(3),
      requestedAt: new Date().toISOString(),
      actor: 'Ann (fleet:1)',
      change: { kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' },
    }),
  );
  const agent = actions();
  await pollChanges(root, agent);
  assert.deepEqual(agent.calls, [{ finish: 'node-b' }]);
  const status = JSON.parse(await readFile(join(root, 'updates/status/changes.json'), 'utf8'));
  assert.equal(status.recent[0].state, 'done');
  assert.equal(status.recent[0].kind, 'cluster-switchover');
});

test('changes are read strictly: a switchover repeats its node, keys only with mirrors', () => {
  assert.throws(
    () => readSiteChange({ kind: 'cluster-switchover', node: 'node-b', confirm: 'node-c' }),
    /repeat the node/,
  );
  assert.throws(
    () =>
      readSiteChange({
        kind: 'mirror-attach',
        repository: 'r',
        upstream: 'http://evil.example',
        sourceRepository: 'r',
      }),
    /HTTPS origin/,
  );
  assert.throws(() => readSiteChange({ kind: 'shell', command: 'rm' }), /Unknown change/);
  assert.throws(
    () => readSiteChange({ kind: 'mirror-key', repository: 'r', key: 'secret' }),
    /Unknown field/,
  );
  assert.equal(
    readSiteChange({
      kind: 'mirror-attach',
      repository: 'r',
      upstream: 'HTTPS://Source.Example/',
      sourceRepository: 'r',
    }).upstream,
    'https://source.example',
  );
});

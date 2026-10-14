import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pollChanges, requestDigest, resetChanges } from '../apps/deploy/dist/site-changes.js';
import { SwitchoverIncomplete } from '../apps/deploy/dist/cluster-ops.js';
import { link } from 'node:fs/promises';
import { digestOf, SiteChangeControl } from '../apps/api/dist/site-change-control.js';
import { readSiteChange } from '../packages/contracts/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';

const key = 'arkvory_' + 'k'.repeat(40);
const posix = process.platform !== 'win32';

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

/** What the agent would do, recorded; `mirrors` are the repositories attached now. */
function actions({ fail, mirrors = [], finish = async () => true, switchover } = {}) {
  const calls = [];
  return {
    calls,
    attached: async () => mirrors,
    mirror: async (_state, change) => {
      calls.push({ mirror: change });
      if (fail) throw new Error(fail);
    },
    switchover: async (node, mark) => {
      calls.push({ switchover: node });
      if (switchover) await switchover(mark);
    },
    finishSwitchover: async (node) => {
      calls.push({ finish: node });
      return finish();
    },
    singleCopy: async (options) => {
      calls.push({ singleCopy: Object.fromEntries(options) });
    },
  };
}

const attach = readSiteChange({
  kind: 'mirror-attach',
  repository: 'imports',
  upstream: 'https://source.example',
  sourceRepository: 'releases',
  stages: ['tested'],
});
const detach = readSiteChange({ kind: 'mirror-detach', repositories: ['imports'] });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const status = async (root) =>
  JSON.parse(await readFile(join(root, 'updates/status/changes.json'), 'utf8'));

test('a mirror change goes through the mailbox once; its key never stays or shows', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await assert.rejects(api.request(id(1), attach, key, 'admin'), { code: 'unavailable' });
  await pollChanges(root, actions());
  assert.equal((await api.status()).agent, true);
  await assert.rejects(api.request(id(1), attach, undefined, 'admin'), { code: 'invalid_input' });
  await assert.rejects(api.request(id(1), attach, 'short', 'admin'), { code: 'invalid_input' });
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  // The key is named after its request: no other request can take it.
  const keyFile = join(root, `updates/inbox/${id(1)}.key`);
  if (posix) assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(await api.status()), /kkkk/);
  // The same id with the same change is the same request; with another change, refused.
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  await assert.rejects(api.request(id(1), detach, undefined, 'admin'), {
    code: 'conflict',
    reason: 'idempotency_mismatch',
  });
  await assert.rejects(api.request(id(2), detach, undefined, 'admin'), { code: 'busy' });
  const agent = actions();
  await pollChanges(root, agent);
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].mirror.secret, key, 'the key is passed as a value, never as a path');
  assert.equal(agent.calls[0].mirror.tokenFile, undefined);
  assert.deepEqual(agent.calls[0].mirror.stages, ['tested']);
  const done = await api.status();
  assert.equal(done.pending, null);
  assert.equal(done.recent[0].state, 'done');
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), []);
  const files = await readdir(root);
  assert.ok(!files.includes('change.key') && !files.includes('change-request.json'));
  assert.doesNotMatch(await readFile(join(root, 'updates/status/changes.json'), 'utf8'), /kkkk/);
  // A finished request is known by its id and digest.
  assert.deepEqual(await api.request(id(1), attach, key, 'admin'), { id: id(1) });
  await assert.rejects(api.request(id(1), detach, undefined, 'admin'), { code: 'conflict' });
});

test('remote changes never widen what a site trusts or name all its mirrors at once', () => {
  assert.throws(
    () => readSiteChange({ ...attach, certificate: '-----BEGIN CERTIFICATE-----' }),
    /Unknown field/,
  );
  for (const repositories of [['all'], ['a', 'a'], []])
    assert.throws(() => readSiteChange({ kind: 'mirror-detach', repositories }), /repositories/);
  assert.throws(
    () => readSiteChange({ kind: 'single-copy', until: '2026-10-14T18:00', reason: 'x' }),
    /zone/,
  );
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
});

test('the agent refuses what does not fit the site and says why in a code', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  const outcome = async (n, change, extra, agent, secret) => {
    await api.request(id(n), change, secret, 'admin');
    await pollChanges(root, agent ?? actions(extra));
    return (await api.status()).recent[0];
  };
  assert.equal(
    (await outcome(1, attach, { mirrors: ['imports'] }, undefined, key)).error,
    'already_attached',
  );
  assert.equal((await outcome(2, detach, { mirrors: [] })).error, 'not_a_mirror');
  const keyChange = readSiteChange({ kind: 'mirror-key', repository: 'imports' });
  assert.equal(
    (await outcome(3, keyChange, { mirrors: [] }, undefined, key)).error,
    'not_a_mirror',
  );
  const failing = await outcome(4, detach, {
    mirrors: ['imports'],
    fail: 'probe of https://10.0.0.5 refused: /etc/x',
  });
  assert.equal(failing.error, 'mirror_failed');
  // The agent's own words (hosts, files) stay in its log on the site.
  assert.doesNotMatch(JSON.stringify(await status(root)), /10\.0\.0\.5|\/etc\/x/);
});

test('a hostile inbox: links, directories and leftovers never reach a key or stop the agent', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  // A directory where the request goes: refused where it lies, never taken into the root and
  // never removed recursively (a subdirectory could become a link to a root-owned tree).
  await mkdir(join(root, 'updates/inbox/change.json/nested'), { recursive: true });
  const victim = join(root, 'victim');
  await mkdir(victim);
  await writeFile(join(victim, 'precious'), 'keep');
  if (posix) await symlink(victim, join(root, 'updates/inbox/change.json/link'));
  const refused = actions();
  await pollChanges(root, refused);
  assert.equal(refused.calls.length, 0);
  assert.deepEqual(await readdir(join(root, 'updates/inbox/change.json/nested')), []);
  assert.equal(await readFile(join(victim, 'precious'), 'utf8'), 'keep');
  assert.ok(!(await readdir(root)).includes('change-request.json'));
  assert.equal((await api.status()).agent, true);
  await rm(join(root, 'updates/inbox/change.json'), { recursive: true });
  // An empty directory is only an empty name: removed without descending.
  await mkdir(join(root, 'updates/inbox/change.json'));
  await pollChanges(root, actions());
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), []);
  // A directory as the key of a request: no key, the attach is refused with a code.
  await api.request(id(5), attach, key, 'admin');
  await rm(join(root, `updates/inbox/${id(5)}.key`), { force: true });
  await mkdir(join(root, `updates/inbox/${id(5)}.key`));
  await pollChanges(root, actions());
  assert.equal((await api.status()).recent[0].error, 'key_missing');
  if (posix) {
    // A link to a root-only file as the key: never followed, never read, never sent.
    const secret = join(root, 'host-secret');
    await writeFile(secret, 'host-password-of-sixteen-chars', { mode: 0o600 });
    await api.request(id(6), attach, key, 'admin');
    await rm(join(root, `updates/inbox/${id(6)}.key`), { force: true });
    await symlink(secret, join(root, `updates/inbox/${id(6)}.key`));
    const agent = actions();
    await pollChanges(root, agent);
    assert.equal(agent.calls.length, 0);
    assert.equal((await api.status()).recent[0].error, 'key_missing');
    assert.equal(await readFile(secret, 'utf8'), 'host-password-of-sixteen-chars');
  }
  // Keys whose request never came go after an hour; fresh ones stay for their request.
  const old = join(root, `updates/inbox/${id(7)}.key`);
  const fresh = join(root, `updates/inbox/${id(8)}.key`);
  await writeFile(old, key);
  await writeFile(fresh, key);
  await writeFile(join(root, 'updates/inbox/.left.tmp'), key);
  const hourAgo = new Date(Date.now() - 2 * 3600000);
  await utimes(old, hourAgo, hourAgo);
  await utimes(join(root, 'updates/inbox/.left.tmp'), hourAgo, hourAgo);
  await pollChanges(root, actions());
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), [`${id(8)}.key`]);
});

test('names, clocks and sizes at their limits', async (t) => {
  const root = await site(t);
  let now = Date.parse('2026-10-14T12:00:00Z');
  const api = new SiteChangeControl(join(root, 'updates'), () => now);
  await pollChanges(root, actions(), () => now);
  // A long administrator name is cut, never a request nobody can read.
  await api.request(id(1), detach, undefined, `${'Ä'.repeat(300)} (fleet:1)`);
  assert.equal((await api.status()).pending.actor.length, 200);
  await pollChanges(root, actions({ mirrors: ['imports'] }), () => now);
  // A request from a clock far ahead expires like an old one.
  await api.request(id(2), detach, undefined, 'admin');
  now -= 31 * 60 * 1000;
  const agent = actions({ mirrors: ['imports'] });
  await pollChanges(root, agent, () => now);
  assert.equal(agent.calls.length, 0);
  assert.equal((await api.status()).recent[0].error, 'expired');
  now += 31 * 60 * 1000;
  await pollChanges(root, actions(), () => now);
  // Twenty records with the longest names stay readable.
  for (let n = 10; n < 32; n++) {
    await api.request(id(n), detach, undefined, 'x'.repeat(400));
    await pollChanges(root, actions({ fail: 'e'.repeat(5000) }), () => now);
  }
  const listed = await api.status();
  assert.equal(listed.recent.length, 20);
  assert.ok((await stat(join(root, 'updates/status/changes.json'))).size < 16384);
});

test('an interrupted change blocks the queue until an operator resets it', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  // The agent took a detach and was killed in the middle of it.
  await writeFile(
    join(root, 'change-request.json'),
    JSON.stringify({
      id: id(1),
      digest: 'a'.repeat(64),
      requestedAt: new Date().toISOString(),
      actor: 'admin',
      change: { kind: 'mirror-detach', repositories: ['imports'] },
    }),
  );
  await pollChanges(root, actions());
  const blocked = await api.status();
  assert.equal(blocked.blocked, 'interrupted');
  assert.equal(blocked.recent[0].error, 'interrupted');
  await assert.rejects(api.request(id(2), detach, undefined, 'admin'), {
    code: 'conflict',
    reason: 'state_conflict',
  });
  await resetChanges(root);
  assert.equal((await api.status()).blocked, null);
  assert.deepEqual(await api.request(id(2), detach, undefined, 'admin'), { id: id(2) });
});

test('a switchover is finished on the new node, retried while young, and judged by where Arkvory runs', async (t) => {
  const root = await site(t);
  const claimed = (n) =>
    writeFile(
      join(root, 'change-request.json'),
      JSON.stringify({
        id: id(n),
        digest: 'b'.repeat(64),
        requestedAt: new Date().toISOString(),
        actor: 'Ann (fleet:1)',
        change: { kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' },
      }),
    );
  await claimed(3);
  // The marker written right before `--move`: a move constraint may exist.
  await writeFile(join(root, 'change-moving'), id(3));
  // Pacemaker is busy right after the move: tried again on the next tick.
  await pollChanges(
    root,
    actions({
      finish: async () => {
        throw new Error('crm busy');
      },
    }),
  );
  assert.ok((await readdir(root)).includes('change-request.json'));
  await pollChanges(root, actions());
  assert.equal((await status(root)).recent[0].state, 'done');
  assert.ok(!(await readdir(root)).includes('change-request.json'));
  assert.ok(!(await readdir(root)).includes('change-moving'));
  // Moved, but clearing the constraint failed: it is done, as Arkvory runs on the target.
  const api = new SiteChangeControl(join(root, 'updates'));
  await api.request(
    id(4),
    readSiteChange({ kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' }),
    undefined,
    'admin',
  );
  await pollChanges(
    root,
    actions({
      switchover: async () => {
        throw new SwitchoverIncomplete(new Error('clear failed'));
      },
    }),
  );
  assert.equal((await status(root)).recent[0].state, 'done');
});

test('a switchover killed before its move is interrupted, never cleared', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  const change = readSiteChange({ kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' });
  // The move marker is written right before the move, for this request only.
  await api.request(id(1), change, undefined, 'admin');
  const moving = actions({
    switchover: async (mark) => {
      await mark();
      assert.equal(await readFile(join(root, 'change-moving'), 'utf8'), id(1));
    },
  });
  await pollChanges(root, moving);
  assert.equal((await status(root)).recent[0].state, 'done');
  // Claimed and killed before the marker (a stale marker of another request does not count).
  await writeFile(join(root, 'change-moving'), id(9));
  await writeFile(
    join(root, 'change-request.json'),
    JSON.stringify({
      id: id(2),
      digest: 'b'.repeat(64),
      requestedAt: new Date().toISOString(),
      actor: 'admin',
      change,
    }),
  );
  const agent = actions();
  await pollChanges(root, agent);
  assert.deepEqual(agent.calls, [], 'no finish, so no crm_resource --clear');
  const after = await status(root);
  assert.equal(after.blocked, 'interrupted');
  assert.equal(after.recent[0].error, 'interrupted');
});

test('the agent recomputes the digest and refuses a request or key swapped in the inbox', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  // The API and the agent hash the same text.
  for (const [change, secret] of [
    [attach, key],
    [detach, undefined],
  ])
    assert.equal(digestOf(change, secret), requestDigest(change, secret ?? null));
  // Another change under the id and digest of a detach.
  await api.request(id(1), detach, undefined, 'admin');
  const inbox = join(root, 'updates/inbox/change.json');
  const sent = JSON.parse(await readFile(inbox, 'utf8'));
  await rm(inbox);
  await writeFile(
    inbox,
    JSON.stringify({ ...sent, change: { kind: 'mirror-detach', repositories: ['other'] } }),
  );
  const agent = actions({ mirrors: ['imports', 'other'] });
  await pollChanges(root, agent);
  assert.equal(agent.calls.length, 0);
  assert.equal((await api.status()).recent[0].error, 'digest_mismatch');
  // Another key beside an attach: never sent to the source.
  await api.request(id(2), attach, key, 'admin');
  const keyFile = join(root, `updates/inbox/${id(2)}.key`);
  await rm(keyFile);
  await writeFile(keyFile, 'attacker_' + 'z'.repeat(40));
  const attacked = actions();
  await pollChanges(root, attacked);
  assert.equal(attacked.calls.length, 0);
  assert.equal((await api.status()).recent[0].error, 'digest_mismatch');
});

test('no change is applied over an unsettled deployment journal', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  await api.request(id(1), detach, undefined, 'admin');
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'switching' }));
  const agent = actions({ mirrors: ['imports'] });
  await assert.rejects(pollChanges(root, agent), /Interrupted deployment/);
  assert.equal(agent.calls.length, 0);
  assert.ok((await readdir(join(root, 'updates/inbox'))).includes('change.json'));
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'committed' }));
  await pollChanges(root, agent);
  assert.equal(agent.calls.length, 1);
});

test('a FIFO in the inbox blocks neither the API nor the agent', async (t) => {
  // mkfifo exists on POSIX hosts only; Windows has no named pipes in a directory.
  if (process.platform === 'win32') return;
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  execFileSync('mkfifo', [join(root, 'updates/inbox/change.json')]);
  const listed = await api.status();
  assert.equal(listed.pending, null);
  assert.equal(listed.agent, true);
  await pollChanges(root, actions());
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), []);
});

test("a switchover refused before its move never clears the operator's constraints", async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  const change = readSiteChange({ kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' });
  await api.request(id(1), change, undefined, 'admin');
  const agent = actions({
    switchover: async () => {
      throw new Error('node-b has no complete copy yet');
    },
  });
  await pollChanges(root, agent);
  assert.deepEqual(
    agent.calls,
    [{ switchover: 'node-b' }],
    'no finish, so no crm_resource --clear',
  );
  assert.equal((await api.status()).recent[0].error, 'switchover_failed');
});

test('races at the slot: a request still being published, a stale key, a claim already done', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  // The API links the request and has not removed its temporary name yet: taken next tick.
  await api.request(id(1), detach, undefined, 'admin');
  const temporary = join(root, 'updates/inbox/.publishing.tmp');
  await link(join(root, 'updates/inbox/change.json'), temporary);
  const early = actions({ mirrors: ['imports'] });
  await pollChanges(root, early);
  assert.equal(early.calls.length, 0);
  assert.ok((await readdir(join(root, 'updates/inbox'))).includes('change.json'));
  await rm(temporary);
  await pollChanges(root, actions({ mirrors: ['imports'] }));
  assert.equal((await api.status()).recent[0].state, 'done');
  // A key of this id left by an earlier attempt is not removed by a refused one.
  const stale = join(root, `updates/inbox/${id(2)}.key`);
  await writeFile(stale, key);
  await writeFile(join(root, 'updates/inbox/change.json'), 'taken by another process');
  await assert.rejects(api.request(id(2), attach, key, 'admin'), { code: 'busy' });
  assert.equal(await readFile(stale, 'utf8'), key);
  await rm(join(root, 'updates/inbox/change.json'));
  // The same id with another key is another request.
  await api.request(id(3), attach, key, 'admin');
  await assert.rejects(api.request(id(3), attach, key.replace('k', 'z'), 'admin'), {
    reason: 'idempotency_mismatch',
  });
  await pollChanges(root, actions());
  // Killed after recording "done", before dropping the claim: no false interruption.
  const done = (await status(root)).recent.find((item) => item.id === id(3));
  await writeFile(
    join(root, 'change-request.json'),
    JSON.stringify({
      id: id(3),
      digest: done.digest,
      requestedAt: done.requestedAt,
      actor: done.actor,
      change: attach,
    }),
  );
  await pollChanges(root, actions());
  assert.equal((await api.status()).blocked, null);
  // Names with astral characters are cut by UTF-16 units, never into a broken request.
  await api.request(id(4), detach, undefined, '😀'.repeat(150));
  const pending = (await api.status()).pending;
  assert.ok(pending.actor.length <= 200 && !/[\ud800-\udbff]$/.test(pending.actor));
});

test('an unreadable status blocks until reset; reset ends what was left applying', async (t) => {
  const root = await site(t);
  const api = new SiteChangeControl(join(root, 'updates'));
  await pollChanges(root, actions());
  const unreadable = JSON.stringify({
    heartbeatAt: new Date().toISOString(),
    recent: [{ id: 'x' }],
  });
  await writeFile(join(root, 'updates/status/changes.json'), unreadable);
  // A switchover claimed and moving when the status became unreadable: kept for the operator.
  const claim = JSON.stringify({
    id: id(8),
    digest: 'd'.repeat(64),
    requestedAt: new Date().toISOString(),
    actor: 'admin',
    change: { kind: 'cluster-switchover', node: 'node-b', confirm: 'node-b' },
  });
  await writeFile(join(root, 'change-request.json'), claim);
  await writeFile(join(root, 'change-moving'), id(8));
  const agent = actions();
  for (let tick = 0; tick < 2; tick++) await pollChanges(root, agent);
  assert.deepEqual(agent.calls, []);
  const blocked = JSON.parse(await readFile(join(root, 'updates/status/changes.json'), 'utf8'));
  assert.equal(blocked.blocked, 'unreadable');
  assert.equal(
    await readFile(join(root, 'updates/status/changes.json.unreadable'), 'utf8'),
    unreadable,
    'the original is kept aside, not overwritten by the heartbeat',
  );
  assert.equal(await readFile(join(root, 'change-request.json'), 'utf8'), claim);
  assert.equal((await api.status()).agent, true);
  await resetChanges(root);
  assert.ok(!(await readdir(root)).includes('change-moving'));
  assert.equal((await api.status()).blocked, null);
  // A switchover whose retries an operator cut short ends as interrupted, not "applying".
  await writeFile(
    join(root, 'updates/status/changes.json'),
    JSON.stringify({
      heartbeatAt: new Date().toISOString(),
      blocked: null,
      recent: [
        {
          id: id(9),
          digest: 'c'.repeat(64),
          kind: 'cluster-switchover',
          state: 'applying',
          error: null,
          actor: 'admin',
          requestedAt: new Date().toISOString(),
          finishedAt: null,
        },
      ],
    }),
  );
  await resetChanges(root);
  const record = (await api.status()).recent[0];
  assert.equal(record.state, 'failed');
  assert.equal(record.error, 'interrupted');
});

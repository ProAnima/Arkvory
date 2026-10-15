import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pollUpdates } from '../apps/deploy/dist/update-control.js';
import { removeTestDirectory } from './helpers.mjs';

const requestId = '00000000-0000-4000-8000-000000000001';

/** An installation with the update mailbox; checked just now, so a tick asks no release source. */
async function site(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-update-control-'));
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
  const now = new Date().toISOString();
  await writeFile(
    join(root, 'updates/status/snapshot.json'),
    JSON.stringify({
      revision: 0,
      currentVersion: '1.0.0',
      currentSchema: 17,
      automatic: false,
      hourUTC: 3,
      pin: null,
      heartbeatAt: now,
      checkedAt: now,
      latest: null,
      phase: 'idle',
      error: null,
      lastAttemptDay: null,
      lastRequestId: null,
    }),
  );
  return root;
}
const snapshot = async (root) =>
  JSON.parse(await readFile(join(root, 'updates/status/snapshot.json'), 'utf8'));
const configure = { id: requestId, expectedRevision: 0, kind: 'configure', automatic: false };

test('an unreadable update request is dropped and reported; the heartbeat goes on', async (t) => {
  const root = await site(t);
  // A field this updater does not know, or anything else the inbox's writers can leave.
  await writeFile(
    join(root, 'updates/inbox/request.json'),
    JSON.stringify({ ...configure, hourUTC: 3, unknown: true }),
  );
  await pollUpdates(root);
  const dropped = await snapshot(root);
  assert.equal(dropped.phase, 'failed');
  assert.equal(dropped.error, 'update_failed');
  assert.equal(dropped.lastRequestId, null);
  assert.deepEqual(await readdir(join(root, 'updates/inbox')), []);
  assert.ok(!(await readdir(root)).includes('update-request.json'));
  // The next tick runs as usual and takes the next request.
  await writeFile(join(root, 'updates/inbox/request.json'), 'not json');
  await pollUpdates(root);
  await writeFile(
    join(root, 'updates/inbox/request.json'),
    JSON.stringify({ ...configure, hourUTC: 4 }),
  );
  await pollUpdates(root);
  const applied = await snapshot(root);
  assert.equal(applied.phase, 'idle');
  assert.equal(applied.hourUTC, 4);
  assert.equal(applied.lastRequestId, requestId);
});

test('a directory as the update request is refused where it lies, never taken', async (t) => {
  const root = await site(t);
  await mkdir(join(root, 'updates/inbox/request.json/nested'), { recursive: true });
  await pollUpdates(root);
  assert.equal((await snapshot(root)).error, 'update_failed');
  assert.deepEqual(await readdir(join(root, 'updates/inbox/request.json')), ['nested']);
  assert.ok(!(await readdir(root)).includes('update-request.json'));
});

test('a readable request left accepted blocks until reset; an unreadable one is dropped', async (t) => {
  const root = await site(t);
  const accepted = join(root, 'update-request.json');
  await writeFile(accepted, JSON.stringify({ ...configure, hourUTC: 4 }));
  await assert.rejects(pollUpdates(root), /Interrupted update request/);
  assert.ok((await readdir(root)).includes('update-request.json'));
  await writeFile(accepted, '{');
  await pollUpdates(root);
  assert.ok(!(await readdir(root)).includes('update-request.json'));
  assert.equal((await snapshot(root)).error, 'update_failed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVault, keyFileSource, newKey } from '@proanima/arkvory-infrastructure';
import { VaultProbe, writeProbeIntervalMs } from '../apps/backup/dist/agent-probe.js';
import { removeTestDirectory } from './helpers.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-agent-probe-'));
  t.after(() => removeTestDirectory(root));
  return root;
}

test('the vault write probe leaves nothing behind and needs a vault', async (t) => {
  const root = await workspace(t);
  const path = join(root, 'vault');
  await FileVault.initialize(path, { vaultId: randomUUID(), createdAt: new Date().toISOString() });
  const vault = await FileVault.open(path);
  await vault.writeProbe();
  assert.deepEqual(await readdir(join(path, 'points', '.staging')), []);
  const unmounted = join(root, 'mount');
  await mkdir(unmounted);
  await assert.rejects((await FileVault.open(unmounted)).writeProbe(), { code: 'vault_missing' });
  assert.deepEqual(await readdir(unmounted), [], 'an empty mount point is never written');
});

/** A vault whose write probe fails while `readOnly` is set; heartbeats count its writes. */
function fakeVault() {
  const vault = {
    readOnly: false,
    writes: 0,
    identity: async () => ({ vaultId: '00000000-0000-4000-8000-0000000000aa' }),
    volume: async () => ({ freeBytes: 10n, totalBytes: 20n }),
    writeProbe: async () => {
      vault.writes++;
      if (vault.readOnly) throw Object.assign(new Error('read-only'), { code: 'EROFS' });
    },
  };
  return vault;
}

test('available means writable: checked on the first heartbeat, then once per interval', async () => {
  const vault = fakeVault();
  let now = 1_000_000;
  const probe = new VaultProbe(vault, () => now);
  assert.equal((await probe.facts()).vaultAvailable, true);
  now += writeProbeIntervalMs - 1;
  assert.equal((await probe.facts()).vaultAvailable, true);
  assert.equal(vault.writes, 1, 'heartbeats between write checks only read');
  // A read-only remount is reported at the next write check, and every heartbeat retries it.
  vault.readOnly = true;
  now += 1;
  const failed = await probe.facts();
  assert.equal(failed.vaultAvailable, false);
  assert.equal(failed.vaultId, '00000000-0000-4000-8000-0000000000aa');
  assert.equal((await probe.facts()).vaultAvailable, false);
  assert.equal(vault.writes, 3);
  vault.readOnly = false;
  assert.equal((await probe.facts()).vaultAvailable, true);
  assert.equal(vault.writes, 4);
});

test('an encrypted vault without its key is unavailable and the heartbeat names why', async (t) => {
  const root = await workspace(t);
  const path = join(root, 'vault');
  const made = await FileVault.initializeEncrypted(path, {
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const keyFile = join(root, 'agent.key');
  const blind = new VaultProbe(await FileVault.open(path));
  const missing = await blind.facts();
  assert.equal(missing.vaultAvailable, false);
  assert.equal(missing.vaultConfigured, true);
  assert.equal(missing.lastError, 'vault_key_missing');

  // A key file that belongs to nothing: still unavailable, and the code says so.
  await writeFile(keyFile, `${newKey('agent').text}\n`);
  const wrong = new VaultProbe(await FileVault.open(path, undefined, keyFileSource(keyFile)));
  const invalid = await wrong.facts();
  assert.equal(invalid.vaultAvailable, false);
  assert.equal(invalid.lastError, 'vault_key_invalid');

  // The right key: available, no error. A later failure of the file puts the code back.
  await writeFile(keyFile, `${made.agentKey}\n`);
  const probe = new VaultProbe(await FileVault.open(path, undefined, keyFileSource(keyFile)));
  const ok = await probe.facts();
  assert.equal(ok.vaultAvailable, true);
  assert.equal(ok.lastError, null);
  assert.equal(ok.vaultId, made.identity.vaultId);
});

test('a key problem does not hide the last failure of the agent once the vault opens', async (t) => {
  const root = await workspace(t);
  const path = join(root, 'vault');
  const made = await FileVault.initializeEncrypted(path, {
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const keyFile = join(root, 'agent.key');
  await writeFile(keyFile, `${made.agentKey}\n`);
  const probe = new VaultProbe(await FileVault.open(path, undefined, keyFileSource(keyFile)));
  probe.lastError = 'vault_full';
  assert.equal((await probe.facts()).lastError, 'vault_full');
});

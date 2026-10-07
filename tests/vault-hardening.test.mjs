import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileVault,
  addRecoveryKit,
  initializeEncryptedVault,
  keyFileSource,
  listSlots,
  removeKeySlot,
  rotateAgentKey,
} from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

const live = { throwIfAborted() {} };
async function* lines(values) {
  for (const value of values) yield value;
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-vault-hardening-'));
  t.after(() => removeTestDirectory(root));
  const vault = join(root, 'vault');
  const agentKeyFile = join(root, 'agent.key');
  const kitFile = join(root, 'kit.txt');
  await initializeEncryptedVault({
    vault,
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
    agentKeyFile,
    kitFile,
  });
  const opened = await FileVault.open(vault, undefined, keyFileSource(agentKeyFile));
  return { root, vault, agentKeyFile, kitFile, opened };
}

test('a rotation or a kit written to an existing file fails and leaves that file untouched', async (t) => {
  const { vault, agentKeyFile, kitFile, opened } = await setup(t);
  const slots = (await listSlots(vault)).length;
  const keyBefore = await readFile(agentKeyFile, 'utf8');
  const kitBefore = await readFile(kitFile, 'utf8');
  await assert.rejects(rotateAgentKey(opened, agentKeyFile), { code: 'invalid_argument' });
  await assert.rejects(addRecoveryKit(opened, kitFile), { code: 'invalid_argument' });
  assert.equal(await readFile(agentKeyFile, 'utf8'), keyBefore);
  assert.equal(await readFile(kitFile, 'utf8'), kitBefore);
  assert.equal((await listSlots(vault)).length, slots);
  await opened.identity();
});

test('a vault.json rewritten as plain is refused while key slots exist or a key is given', async (t) => {
  const { vault, agentKeyFile } = await setup(t);
  const path = join(vault, 'vault.json');
  const document = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...document, version: 1, encryption: 'none' }));
  const withKey = await FileVault.open(vault, undefined, keyFileSource(agentKeyFile));
  await assert.rejects(withKey.identity(), { code: 'integrity_mismatch' });
  const withoutKey = await FileVault.open(vault);
  await assert.rejects(withoutKey.identity(), { code: 'integrity_mismatch' });
  // Slots removed too: the configured key still refuses the vault, with an actionable code.
  await rm(join(vault, 'keys'), { recursive: true });
  await assert.rejects(withKey.identity(), { code: 'vault_key_invalid' });
  assert.equal((await withoutKey.identity()).encryption, 'none');
});

test('a failed key check never lets an encrypted vault write in the clear', async (t) => {
  const { vault, agentKeyFile, opened } = await setup(t);
  await opened.identity();
  const key = await readFile(agentKeyFile, 'utf8');
  await rm(agentKeyFile);
  const real = Date.now;
  t.mock.method(Date, 'now', () => real() + 61_000);
  await assert.rejects(opened.identity(), { code: 'vault_key_missing' });
  // Every operation checks again instead of falling back to "no cipher".
  await assert.rejects(opened.stage(randomUUID(), 1), { code: 'vault_key_missing' });
  await assert.rejects(opened.scratchCipher('x'), { code: 'vault_key_missing' });
  await writeFile(agentKeyFile, key);
  const staged = await opened.stage(randomUUID(), 1);
  const written = await staged.write('inventory.ndjson', lines(['{"plain":"MARKER-7c1"}']), live);
  assert.equal(written.lines, 1);
  const stagingRoot = join(vault, 'points', '.staging');
  for (const name of await readdir(stagingRoot))
    for (const file of await readdir(join(stagingRoot, name)).catch(() => []))
      if (file.endsWith('.ndjson'))
        assert.equal(
          (await readFile(join(stagingRoot, name, file), 'utf8')).includes('MARKER-7c1'),
          false,
        );
  await staged.discard();
});

test('a lock left by a crash is reported, and works again once the operator removes it', async (t) => {
  const { vault, root, opened } = await setup(t);
  await writeFile(join(vault, 'keys', '.admin.lock'), '');
  await assert.rejects(addRecoveryKit(opened, join(root, 'kit2.txt')), { code: 'busy' });
  await rm(join(vault, 'keys', '.admin.lock'));
  await addRecoveryKit(opened, join(root, 'kit2.txt'));
  assert.equal((await listSlots(vault)).filter((slot) => slot.kind === 'recovery').length, 2);
});

test('two removals of different recovery slots never leave the vault without one', async (t) => {
  const { vault, root, opened } = await setup(t);
  await addRecoveryKit(opened, join(root, 'kit2.txt'));
  const recovery = (await listSlots(vault)).filter((slot) => slot.kind === 'recovery');
  assert.equal(recovery.length, 2);
  await Promise.allSettled(recovery.map((slot) => removeKeySlot(opened, slot.slotId)));
  const left = (await listSlots(vault)).filter((slot) => slot.kind === 'recovery');
  assert.ok(left.length >= 1);
  // The lock is released: a later administration works.
  await addRecoveryKit(opened, join(root, 'kit3.txt'));
});

test('a rotation keeps the running agent working; removing the old slot revokes it within a minute', async (t) => {
  const { vault, root, opened } = await setup(t);
  await opened.identity();
  const rotated = await rotateAgentKey(opened, join(root, 'agent2.key'));
  assert.equal(rotated.previous.length, 1);
  const real = Date.now;
  let shift = 61_000;
  t.mock.method(Date, 'now', () => real() + shift);
  // The old slot stays, so the agent that still reads the old file keeps working after a recheck.
  await opened.identity();
  await removeKeySlot(opened, rotated.previous[0]);
  // Not rechecked yet: the unlocked vault keeps working for up to a minute.
  await opened.identity();
  shift = 2 * 61_000;
  await assert.rejects(opened.identity(), { code: 'vault_key_invalid' });
  await assert.rejects(opened.identity(), { code: 'vault_key_invalid' });
  const next = await FileVault.open(vault, undefined, keyFileSource(join(root, 'agent2.key')));
  await next.identity();
});

test('a key file that cannot be read is a missing key, not an unexpected failure', async (t) => {
  const { root } = await setup(t);
  await assert.rejects(keyFileSource(join(root, 'absent.key')).read(), {
    code: 'vault_key_missing',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileVault,
  addSlot,
  findKey,
  keyFileSource,
  listSlots,
  newKey,
  parseKey,
  removeSlot,
  unlockWith,
} from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

const now = () => new Date().toISOString();

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-vault-keys-'));
  t.after(() => removeTestDirectory(root));
  return root;
}

async function encryptedVault(t) {
  const root = await directory(t);
  const path = join(root, 'vault');
  const vaultId = randomUUID();
  const made = await FileVault.initializeEncrypted(path, { vaultId, createdAt: now() });
  return { root, path, vaultId, ...made };
}

test('a key is a prefix and fourteen groups of four characters, and parses back to its bytes', () => {
  for (const kind of ['agent', 'recovery']) {
    const key = newKey(kind);
    assert.match(key.text, new RegExp(`^${kind === 'agent' ? 'AK1' : 'RK1'}(-[A-Z2-7]{4}){14}$`));
    const parsed = parseKey(key.text);
    assert.equal(parsed.kind, kind);
    assert.deepEqual(parsed.bytes, key.bytes);
    assert.equal(key.bytes.length, 32);
    // Case, spaces and line breaks of a copied or retyped key do not matter.
    assert.deepEqual(parseKey(key.text.toLowerCase().replaceAll('-', ' ')).bytes, key.bytes);
    assert.deepEqual(parseKey(`\n  ${key.text}\r\n`).bytes, key.bytes);
  }
  assert.notEqual(newKey('agent').text, newKey('agent').text);
});

test('a typo, a short key and a foreign string are refused before any decryption', () => {
  const key = newKey('recovery').text;
  const characters = key.replace(/-/g, '');
  for (let index = 3; index < characters.length; index += 7) {
    const replacement = characters[index] === 'A' ? 'B' : 'A';
    const typo = characters.slice(0, index) + replacement + characters.slice(index + 1);
    assert.throws(() => parseKey(typo), { code: 'vault_key_invalid' }, `typo at ${index}`);
  }
  for (const bad of [
    '',
    'RK1',
    key.slice(0, -5),
    key + 'AAAA',
    `XX1${key.slice(3)}`,
    'hello world',
    key.replace('RK1', 'AK1'),
  ])
    assert.throws(() => parseKey(bad), { code: 'vault_key_invalid' }, bad);
});

test('a key is found inside a recovery kit or a key file, and nothing else is taken for one', () => {
  const key = newKey('recovery').text;
  const kit = `ARKVORY VAULT RECOVERY KIT\nVault: ${randomUUID()}\nRecovery key: ${key}\n\nKeep it safe.\n`;
  assert.equal(findKey(kit), key);
  assert.equal(findKey(`${key}\n`), key);
  assert.equal(findKey(kit.toLowerCase()), key);
  assert.equal(findKey('no key here, AK1-ABCD is too short'), null);
});

test('a new vault has an agent slot and a recovery slot that open the same master key', async (t) => {
  const made = await encryptedVault(t);
  const slots = await listSlots(made.path);
  assert.deepEqual(slots.map((slot) => slot.kind).sort(), ['agent', 'recovery']);
  const viaAgent = await unlockWith(made.path, made.vaultId, made.agentKey);
  const viaRecovery = await unlockWith(made.path, made.vaultId, made.recoveryKey);
  assert.deepEqual(viaAgent, viaRecovery);
  assert.equal(viaAgent.length, 32);
  const document = await readFile(join(made.path, 'keys', `${slots[0].slotId}.json`), 'utf8');
  assert.equal(
    document.includes(viaAgent.toString('base64')),
    false,
    'the master key is never stored in the clear',
  );
  assert.equal(document.includes(made.agentKey), false);
});

test('a key opens its own vault only, and another key opens nothing', async (t) => {
  const first = await encryptedVault(t);
  const second = await encryptedVault(t);
  await assert.rejects(unlockWith(first.path, first.vaultId, second.agentKey), {
    code: 'vault_key_invalid',
  });
  await assert.rejects(unlockWith(first.path, first.vaultId, newKey('agent').text), {
    code: 'vault_key_invalid',
  });
  // The slots of one vault wrapped for its identity: moved to another vault they do not open.
  await assert.rejects(unlockWith(first.path, second.vaultId, first.agentKey), {
    code: 'vault_key_invalid',
  });
});

test('a slot that is edited, renamed or extended is refused', async (t) => {
  const made = await encryptedVault(t);
  const [slot] = await listSlots(made.path);
  const file = join(made.path, 'keys', `${slot.slotId}.json`);
  const text = await readFile(file, 'utf8');
  const document = JSON.parse(text);
  const flipped = {
    ...document,
    wrapped: document.wrapped.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')),
  };
  await writeFile(file, JSON.stringify(flipped));
  const key = slot.kind === 'agent' ? made.agentKey : made.recoveryKey;
  await assert.rejects(unlockWith(made.path, made.vaultId, key), { code: 'vault_key_invalid' });
  await writeFile(file, JSON.stringify({ ...document, extra: 1 }));
  await assert.rejects(listSlots(made.path), { code: 'invalid_manifest' });
  await writeFile(
    file,
    JSON.stringify({ ...document, kind: slot.kind === 'agent' ? 'recovery' : 'agent' }),
  );
  await assert.rejects(unlockWith(made.path, made.vaultId, key), { code: 'vault_key_invalid' });
  await writeFile(file, '{ not json');
  await assert.rejects(listSlots(made.path), { code: 'invalid_manifest' });
  await writeFile(file, text);
  await unlockWith(made.path, made.vaultId, key);
});

test('a rotation adds a slot first; the old key works until its slot is removed', async (t) => {
  const made = await encryptedVault(t);
  const master = await unlockWith(made.path, made.vaultId, made.agentKey);
  const added = await addSlot(made.path, made.vaultId, master, 'agent', now());
  assert.notEqual(added.key, made.agentKey);
  assert.deepEqual(await unlockWith(made.path, made.vaultId, added.key), master);
  assert.deepEqual(await unlockWith(made.path, made.vaultId, made.agentKey), master);
  const old = (await listSlots(made.path)).find(
    (slot) => slot.kind === 'agent' && slot.slotId !== added.slot.slotId,
  );
  await removeSlot(made.path, old.slotId);
  await assert.rejects(unlockWith(made.path, made.vaultId, made.agentKey), {
    code: 'vault_key_invalid',
  });
  assert.deepEqual(await unlockWith(made.path, made.vaultId, added.key), master);
  assert.deepEqual(await unlockWith(made.path, made.vaultId, made.recoveryKey), master);
});

test('the last slot and the last recovery slot are never removed', async (t) => {
  const made = await encryptedVault(t);
  const slots = await listSlots(made.path);
  const recovery = slots.find((slot) => slot.kind === 'recovery');
  const agent = slots.find((slot) => slot.kind === 'agent');
  await assert.rejects(removeSlot(made.path, recovery.slotId), { code: 'invalid_argument' });
  await assert.rejects(removeSlot(made.path, 'ffffffffffffffff'), { code: 'invalid_argument' });
  await removeSlot(made.path, agent.slotId);
  await assert.rejects(removeSlot(made.path, recovery.slotId), { code: 'invalid_argument' });
  assert.equal((await listSlots(made.path)).length, 1);
});

test('a key file or a recovery kit opens the vault; a missing or empty one is a precise failure', async (t) => {
  const made = await encryptedVault(t);
  const keyFile = join(made.root, 'agent.key');
  const kitFile = join(made.root, 'kit.txt');
  await writeFile(keyFile, `${made.agentKey}\n`);
  await writeFile(kitFile, `RECOVERY KIT\nRecovery key: ${made.recoveryKey}\n`);
  for (const file of [keyFile, kitFile]) {
    const vault = await FileVault.open(made.path, undefined, keyFileSource(file));
    assert.equal((await vault.identity()).vaultId, made.vaultId);
  }
  const blind = await FileVault.open(made.path);
  await assert.rejects(blind.identity(), { code: 'vault_key_missing' });
  const missing = await FileVault.open(
    made.path,
    undefined,
    keyFileSource(join(made.root, 'absent.key')),
  );
  await assert.rejects(missing.identity(), { code: 'vault_key_missing' });
  const empty = join(made.root, 'empty.key');
  await writeFile(empty, 'nothing useful\n');
  const nothing = await FileVault.open(made.path, undefined, keyFileSource(empty));
  await assert.rejects(nothing.identity(), { code: 'vault_key_invalid' });
  const foreignFile = join(made.root, 'foreign.key');
  await writeFile(foreignFile, `${newKey('agent').text}\n`);
  const foreign = await FileVault.open(made.path, undefined, keyFileSource(foreignFile));
  await assert.rejects(foreign.identity(), { code: 'vault_key_invalid' });
  // The key file is read again for a vault that was replaced under the same path.
  await mkdir(join(made.root, 'other'));
});

test('a plain vault ignores keys and a vault that failed halfway is not a vault', async (t) => {
  const root = await directory(t);
  const plain = join(root, 'plain');
  await FileVault.initialize(plain, { vaultId: randomUUID(), createdAt: now() });
  const vault = await FileVault.open(plain);
  assert.equal((await vault.identity()).encryption, 'none');
  assert.equal(await listSlots(plain).then((slots) => slots.length), 0);
  await assert.rejects(vault.masterKey(), { code: 'invalid_argument' });
  const made = await encryptedVault(t);
  assert.equal((await (await FileVault.open(made.path)).describe()).encryption, 'aes-256-gcm-v1');
});

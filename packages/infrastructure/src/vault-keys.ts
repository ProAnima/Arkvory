import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import { hasCode, syncDirectory } from './fs-durability.js';
import { VAULT_DIRECTORY_MODE, writeDurably } from './vault-files.js';

/*
 * Access to an encrypted vault (ADR 0070). The master key is random and never stored in the
 * clear. Each key slot (keys/<slot>.json) holds it wrapped by the random key of that slot: an
 * `agent` slot for the service, `recovery` slots for the operator's recovery kit. A key is shown
 * as a prefix and 14 groups of four Base32 characters; the last group is a checksum, so a typo
 * is found before any decryption is tried.
 */

export type KeyKind = 'agent' | 'recovery';
const prefixes: Readonly<Record<KeyKind, string>> = { agent: 'AK1', recovery: 'RK1' };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_BYTES = 32;
const KEYS_DIRECTORY = 'keys';
const MAX_SLOTS = 32;
const MAX_SLOT_BYTES = 4096;
const slotIdPattern = /^[0-9a-f]{16}$/;
const never = { throwIfAborted() {} };

function invalidKey(message: string): BackupFailure {
  return new BackupFailure('vault_key_invalid', message);
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet.charAt((value << (5 - bits)) & 31);
  return out;
}

function unbase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of text) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw invalidKey('The key has characters outside Base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  // The unused low bits of the last character are zero in a key this code wrote.
  if ((value & ((1 << bits) - 1)) !== 0) throw invalidKey('The key is not valid');
  return Buffer.from(out);
}

function checksum(prefix: string, bytes: Uint8Array): string {
  const digest = createHash('sha256')
    .update(`arkvory-vault-key-v1|${prefix}|`)
    .update(bytes)
    .digest();
  return base32(digest.subarray(0, 3)).slice(0, 4);
}

/** A new random key as the string the operator or the service stores. */
export function newKey(kind: KeyKind): { readonly text: string; readonly bytes: Buffer } {
  const bytes = randomBytes(KEY_BYTES);
  const body = base32(bytes) + checksum(prefixes[kind], bytes);
  const groups = body.match(/.{4}/g) ?? [];
  return { text: `${prefixes[kind]}-${groups.join('-')}`, bytes };
}

/** The key inside a key file or a recovery kit: the first well-formed key string of the text. */
export function findKey(text: string): string | null {
  return /\b(?:AK1|RK1)(?:-[A-Z2-7]{4}){14}\b/.exec(text.toUpperCase())?.[0] ?? null;
}

export function parseKey(text: string): { readonly kind: KeyKind; readonly bytes: Buffer } {
  const cleaned = text.toUpperCase().replace(/[\s-]/g, '');
  const kind: KeyKind | null = cleaned.startsWith('AK1')
    ? 'agent'
    : cleaned.startsWith('RK1')
      ? 'recovery'
      : null;
  if (kind === null || cleaned.length !== 3 + 56) throw invalidKey('The key is not valid');
  const body = cleaned.slice(3);
  const bytes = unbase32(body.slice(0, 52));
  if (bytes.length !== KEY_BYTES || body.slice(52) !== checksum(prefixes[kind], bytes))
    throw invalidKey('The key has a typo: its checksum does not match');
  return { kind, bytes };
}

export interface KeySlot {
  readonly slotId: string;
  readonly kind: KeyKind;
  readonly createdAt: string;
  readonly nonce: string;
  readonly wrapped: string;
}

function slotContext(vaultId: string, slotId: string, kind: KeyKind): Buffer {
  return Buffer.from(`arkvory-vault-v1/slot|${vaultId}|${slotId}|${kind}`);
}

function wrap(vaultId: string, slotId: string, kind: KeyKind, key: Buffer, master: Buffer) {
  const context = slotContext(vaultId, slotId, kind);
  const wrapKey = Buffer.from(hkdfSync('sha256', key, Buffer.from(vaultId), context, 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrapKey, nonce, { authTagLength: 16 });
  cipher.setAAD(context);
  const wrapped = Buffer.concat([cipher.update(master), cipher.final(), cipher.getAuthTag()]);
  return { nonce: nonce.toString('base64url'), wrapped: wrapped.toString('base64url') };
}

function unwrap(vaultId: string, slot: KeySlot, key: Buffer): Buffer | null {
  const context = slotContext(vaultId, slot.slotId, slot.kind);
  const wrapKey = Buffer.from(hkdfSync('sha256', key, Buffer.from(vaultId), context, 32));
  const data = Buffer.from(slot.wrapped, 'base64url');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      wrapKey,
      Buffer.from(slot.nonce, 'base64url'),
      {
        authTagLength: 16,
      },
    );
    decipher.setAAD(context);
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  } catch {
    return null;
  }
}

export function parseSlot(text: string): KeySlot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BackupFailure('invalid_manifest', 'A key slot is not valid JSON', { cause: error });
  }
  const row: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {};
  const known = ['format', 'version', 'slotId', 'kind', 'createdAt', 'nonce', 'wrapped'];
  const { slotId, kind, createdAt, nonce, wrapped } = row;
  if (
    Object.keys(row).some((key) => !known.includes(key)) ||
    row['format'] !== 'arkvory-vault-key' ||
    row['version'] !== 1 ||
    typeof slotId !== 'string' ||
    !slotIdPattern.test(slotId) ||
    (kind !== 'agent' && kind !== 'recovery') ||
    typeof createdAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/.test(createdAt) ||
    typeof nonce !== 'string' ||
    Buffer.from(nonce, 'base64url').length !== 12 ||
    typeof wrapped !== 'string' ||
    Buffer.from(wrapped, 'base64url').length !== KEY_BYTES + 16
  )
    throw new BackupFailure('invalid_manifest', 'A key slot is invalid');
  return { slotId, kind, createdAt, nonce, wrapped };
}

function slotText(slot: KeySlot): string {
  return (
    JSON.stringify(
      { format: 'arkvory-vault-key', version: 1, ...slot },
      ['format', 'version', 'slotId', 'kind', 'createdAt', 'nonce', 'wrapped'],
      2,
    ) + '\n'
  );
}

async function* once(text: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield Buffer.from(text);
}

async function writeSlot(root: string, slot: KeySlot): Promise<void> {
  await writeDurably(join(root, KEYS_DIRECTORY, `${slot.slotId}.json`), once(slotText(slot)), {
    cancellation: never,
  });
}

/** The slots of a vault, oldest first; a damaged slot file fails instead of being skipped. */
export async function listSlots(root: string): Promise<readonly KeySlot[]> {
  let names: string[];
  try {
    names = await readdir(join(root, KEYS_DIRECTORY));
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [];
    throw error;
  }
  const slots: KeySlot[] = [];
  for (const name of names.sort()) {
    if (!/^[0-9a-f]{16}\.json$/.test(name)) continue;
    const path = join(root, KEYS_DIRECTORY, name);
    if ((await stat(path)).size > MAX_SLOT_BYTES)
      throw new BackupFailure('invalid_manifest', 'A key slot is too large');
    const slot = parseSlot(await readFile(path, 'utf8'));
    if (`${slot.slotId}.json` !== name)
      throw new BackupFailure('invalid_manifest', 'A key slot has the wrong name');
    slots.push(slot);
  }
  return slots.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.slotId.localeCompare(b.slotId),
  );
}

/** Creates the key directory with an agent slot and a recovery slot; returns the keys once. */
export async function createKeys(
  root: string,
  vaultId: string,
  now: string,
): Promise<{ master: Buffer; agentKey: string; recoveryKey: string }> {
  const master = randomBytes(KEY_BYTES);
  await mkdir(join(root, KEYS_DIRECTORY), { mode: VAULT_DIRECTORY_MODE });
  const agent = await addSlot(root, vaultId, master, 'agent', now);
  const recovery = await addSlot(root, vaultId, master, 'recovery', now);
  return { master, agentKey: agent.key, recoveryKey: recovery.key };
}

/** A new slot of `kind` with a new random key, which is returned and never stored. */
export async function addSlot(
  root: string,
  vaultId: string,
  master: Buffer,
  kind: KeyKind,
  now: string,
): Promise<{ readonly slot: KeySlot; readonly key: string }> {
  const slotId = randomBytes(8).toString('hex');
  const key = newKey(kind);
  const slot: KeySlot = {
    slotId,
    kind,
    createdAt: now,
    ...wrap(vaultId, slotId, kind, key.bytes, master),
  };
  if ((await listSlots(root)).length >= MAX_SLOTS)
    throw new BackupFailure(
      'invalid_argument',
      `A vault has at most ${String(MAX_SLOTS)} key slots`,
    );
  await writeSlot(root, slot);
  await syncDirectory(join(root, KEYS_DIRECTORY));
  return { slot, key: key.text };
}

/** The master key that this key opens: the first slot of its kind that it unwraps. */
export async function unlockWith(root: string, vaultId: string, keyText: string): Promise<Buffer> {
  const key = parseKey(keyText);
  for (const slot of await listSlots(root)) {
    if (slot.kind !== key.kind) continue;
    const master = unwrap(vaultId, slot, key.bytes);
    if (master !== null && master.length === KEY_BYTES) return master;
  }
  throw invalidKey('The key does not open this vault');
}

/** Removes a slot. The last slot and the last recovery slot stay: a vault must remain recoverable. */
export async function removeSlot(root: string, slotId: string): Promise<void> {
  const slots = await listSlots(root);
  const target = slots.find((slot) => slot.slotId === slotId);
  if (target === undefined) throw new BackupFailure('invalid_argument', 'No such key slot');
  if (slots.length === 1)
    throw new BackupFailure('invalid_argument', 'The last key slot of a vault is never removed');
  if (target.kind === 'recovery' && slots.filter((slot) => slot.kind === 'recovery').length === 1)
    throw new BackupFailure('invalid_argument', 'The last recovery slot is never removed');
  await unlink(join(root, KEYS_DIRECTORY, `${slotId}.json`));
  await syncDirectory(join(root, KEYS_DIRECTORY));
}

const ADMIN_LOCK = '.admin.lock';
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Key administration of one vault runs one at a time: two removals must not both pass the
 * "last recovery slot" check. The lock is a file in the key directory created exclusively; one
 * left by a crashed process is taken over after ten minutes.
 */
export async function withKeyAdministration<T>(root: string, work: () => Promise<T>): Promise<T> {
  const path = join(root, KEYS_DIRECTORY, ADMIN_LOCK);
  for (let attempt = 0; ; attempt++) {
    try {
      await (await open(path, 'wx', 0o600)).close();
      break;
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      const age = await stat(path).then(
        (info) => Date.now() - info.mtimeMs,
        () => 0,
      );
      if (attempt > 0 || age < STALE_LOCK_MS)
        throw new BackupFailure(
          'invalid_argument',
          'Another key administration of this vault is running (or remove keys/.admin.lock after a crash)',
        );
      await unlink(path).catch(() => undefined);
    }
  }
  try {
    return await work();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

/** Where the key of an encrypted vault comes from: read when the vault is first used (ADR 0070). */
export interface VaultKeySource {
  /** The key string; `vault_key_missing` when there is none, `vault_key_invalid` when it is no key. */
  read(): Promise<string>;
}

const MAX_KEY_FILE_BYTES = 64 * 1024;

/** A key file: the agent key, or a recovery kit; the file is read again at each use. */
export function keyFileSource(path: string): VaultKeySource {
  return {
    async read() {
      let text: string;
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_KEY_FILE_BYTES)
          throw new BackupFailure('vault_key_invalid', 'The key file is not a key file');
        text = await readFile(path, 'utf8');
      } catch (error) {
        if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR'))
          throw new BackupFailure('vault_key_missing', 'The vault key file does not exist');
        if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM'))
          throw new BackupFailure('vault_key_missing', 'The vault key file cannot be read');
        throw error;
      }
      const key = findKey(text);
      if (key === null)
        throw new BackupFailure('vault_key_invalid', 'The key file holds no vault key');
      return key;
    },
  };
}

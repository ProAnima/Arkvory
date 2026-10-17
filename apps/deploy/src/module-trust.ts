import { readFile, stat } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { isAbsolute } from 'node:path';
import {
  MAX_TRUSTED_KEYS,
  keyFingerprint,
  operatorKeyExpired,
  parseMinisignPublicKey,
  pluginPattern,
  utcTime,
} from '@proanima/arkvory-signing';
import type { OperatorKey, PluginTrust } from '@proanima/arkvory-signing';
import type { Installation } from './model.js';
import { hostKeys, readTrustList, trustPath, writeHostFile } from './module-host.js';
import type { ModuleCommandContext } from './module-host.js';

export interface TrustAddition {
  /** An absolute path of a minisign `.pub` file, or the key line itself. */
  readonly key: string;
  readonly label: string | undefined;
  readonly plugins: string | undefined;
  readonly allowInProcess: boolean;
  readonly expires: string | undefined;
  readonly yes: boolean;
}

const LABEL = /^[^\p{Cc}]{1,128}$/u;

async function publicKeyText(argument: string): Promise<string> {
  if (!isAbsolute(argument)) return argument;
  const info = await stat(argument);
  if (!info.isFile() || info.size > 4096)
    throw new Error('The key file must be a minisign .pub file');
  return readFile(argument, 'utf8');
}

function trustText(trust: PluginTrust): string {
  return JSON.stringify(trust, null, 2) + '\n';
}

function describe(key: OperatorKey, now: number): string[] {
  return [
    `Key ${key.keyId}  fingerprint ${keyFingerprint({ id: key.keyId, publicKey: key.publicKey })}`,
    `  label: ${key.label}`,
    `  plugins: ${key.plugins.join(', ')}`,
    `  in process: ${key.allowInProcess ? 'allowed (full trust)' : 'no'}`,
    `  added: ${key.addedAt} by ${key.addedBy}`,
    `  expires: ${key.expiresAt ?? 'never'}${operatorKeyExpired(key, now) ? ' (expired)' : ''}`,
  ];
}

/**
 * `arkvory module trust add` (ADR 0082, section 3): only a host administrator writes the list,
 * so a captured administrator account of the console never makes code run on the server. The
 * key, its fingerprint and its scope are shown first; nothing is written without `--yes`.
 */
export async function trustAdd(
  root: string,
  state: Installation,
  addition: TrustAddition,
  context: ModuleCommandContext,
): Promise<void> {
  const parsed = parseMinisignPublicKey(await publicKeyText(addition.key));
  const label = addition.label?.trim() ?? '';
  if (!LABEL.test(label)) throw new Error('--label must name the key holder (1 to 128 characters)');
  const plugins = (addition.plugins ?? 'op-*')
    .split(',')
    .map((item, index) => pluginPattern(item.trim(), `--plugins ${String(index + 1)}`));
  const now = context.now();
  const expiresAt = addition.expires === undefined ? null : utcTime(addition.expires, '--expires');
  if (expiresAt !== null && Date.parse(expiresAt) <= now)
    throw new Error('--expires must be a future UTC time such as 2027-01-31T00:00:00Z');
  const trust = await readTrustList(root);
  if (trust.keys.some((key) => key.keyId === parsed.id))
    throw new Error(`Key ${parsed.id} is already trusted; remove it first to change it`);
  if (trust.keys.length >= MAX_TRUSTED_KEYS) throw new Error('The trust list is full');
  const user = `${userInfo().username}@${hostname()}`.replace(/\p{Cc}/gu, '').slice(0, 128);
  const entry: OperatorKey = {
    keyId: parsed.id,
    publicKey: parsed.publicKey,
    label,
    plugins: [...new Set(plugins)],
    allowInProcess: addition.allowInProcess,
    addedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    addedBy: LABEL.test(user) ? user : 'unknown',
    expiresAt,
  };
  const next: PluginTrust = { format: 1, keys: [...trust.keys, entry] };
  // A key of a release, module or license class is never trusted again as an operator key.
  hostKeys(context, next);
  describe(entry, now).forEach((line) => {
    context.print(line);
  });
  if (entry.allowInProcess)
    context.print(
      'Warning: in-process plugins of this key get every right of the core process: database, keys, files and network.',
    );
  if (!addition.yes)
    throw new Error("Compare the fingerprint with the key's author, then repeat with --yes");
  await writeHostFile(root, state, trustPath(root), trustText(next));
  context.print(`Trusted key ${entry.keyId}`);
}

/** `arkvory module trust remove <keyId>`: no new installation or start with this key. */
export async function trustRemove(
  root: string,
  state: Installation,
  keyId: string,
  context: ModuleCommandContext,
): Promise<void> {
  const trust = await readTrustList(root);
  if (!trust.keys.some((key) => key.keyId === keyId))
    throw new Error('No trusted key has this id; see arkvory module trust list');
  const next: PluginTrust = { format: 1, keys: trust.keys.filter((key) => key.keyId !== keyId) };
  await writeHostFile(root, state, trustPath(root), trustText(next));
  context.print(`Removed key ${keyId}`);
}

export async function trustList(root: string, context: ModuleCommandContext): Promise<void> {
  const trust = await readTrustList(root);
  if (!trust.keys.length) context.print('No operator keys are trusted on this host.');
  for (const key of trust.keys)
    describe(key, context.now()).forEach((line) => {
      context.print(line);
    });
}

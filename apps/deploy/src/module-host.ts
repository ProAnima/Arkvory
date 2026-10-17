import { open, stat } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_API_VERSION } from '@proanima/arkvory-extension-api';
import {
  PLUGIN_TRUST_FILE,
  REVOCATIONS_FILE,
  keyRing,
  licenseKeys,
  moduleKeys,
  parsePluginTrust,
  readRevocations,
  revocationsCurrent,
} from '@proanima/arkvory-signing';
import type {
  ClassifiedKey,
  PackageHost,
  PluginTrust,
  RevocationList,
  SigningKey,
} from '@proanima/arkvory-signing';
import { atomicText, inside, jsonFile, readOptional } from './files.js';
import type { FileOwner } from './files.js';
import type { Installation } from './model.js';
import { moduleLayout } from './module-store.js';
import { releaseKeys } from './release-keys.js';

/** What module commands trust and how they report; tests pass throwaway keys and a clock. */
export interface ModuleCommandContext {
  readonly moduleKeys: readonly SigningKey[];
  readonly licenseKeys: readonly SigningKey[];
  readonly releaseKeys: readonly SigningKey[];
  readonly extensionApi: string;
  readonly now: () => number;
  readonly print: (line: string) => void;
}

export const defaultModuleContext: ModuleCommandContext = {
  moduleKeys,
  licenseKeys,
  releaseKeys,
  extensionApi: EXTENSION_API_VERSION,
  now: () => Date.now(),
  print: (line) => {
    console.log(line);
  },
};

export const trustPath = (root: string) => inside(root, 'config', PLUGIN_TRUST_FILE);
export const revocationsPath = (root: string) => inside(root, 'config', REVOCATIONS_FILE);

/**
 * Host-managed settings the services only read (ADR 0082, P7): the owner and group of
 * runtime.json (root and the service group on Linux), 0640; Compose containers read the
 * configuration directory as another user, so 0644 there. Windows keeps the ACL of `config`.
 */
async function hostFileAccess(
  root: string,
  state: Installation,
): Promise<{ mode: number; owner: FileOwner }> {
  const runtime = await stat(join(root, 'config', 'runtime.json'));
  return {
    mode: state.mode === 'compose' ? 0o644 : 0o640,
    owner: { uid: runtime.uid, gid: runtime.gid },
  };
}

export async function writeHostFile(
  root: string,
  state: Installation,
  path: string,
  text: string,
): Promise<void> {
  const access = await hostFileAccess(root, state);
  await atomicText(path, text, access.mode, access.owner);
}

/** The operator trust list; an installation without one trusts no operator key. */
export async function readTrustList(root: string): Promise<PluginTrust> {
  const path = trustPath(root);
  if ((await readOptional(path)) === null) return { format: 1, keys: [] };
  return parsePluginTrust(await jsonFile(path));
}

export function hostKeys(
  context: ModuleCommandContext,
  trust: PluginTrust,
): readonly ClassifiedKey[] {
  return keyRing({
    release: context.releaseKeys,
    module: context.moduleKeys,
    license: context.licenseKeys,
    operator: trust.keys,
  });
}

export async function packageHost(
  root: string,
  state: Installation,
  context: ModuleCommandContext,
): Promise<PackageHost> {
  return {
    keys: hostKeys(context, await readTrustList(root)),
    extensionApi: context.extensionApi,
    coreVersion: state.current.version,
    now: context.now(),
  };
}

/** The stored revocation list, verified again on every read; null before the first one. */
export async function readStoredRevocations(
  root: string,
  keys: readonly ClassifiedKey[],
): Promise<RevocationList | null> {
  const text = await readOptional(revocationsPath(root));
  return text === null ? null : readRevocations(text, keys);
}

/** Why the newest known list does not make an install or pin current, or null when it does. */
export function staleRevocations(list: RevocationList | null, now: number): string | null {
  if (revocationsCurrent(list, now)) return null;
  return list === null
    ? 'no revocation list is stored'
    : `list ${String(list.sequence)} expired at ${list.expiresAt}`;
}

/**
 * Installs and pins need a current list (ADR 0078, 3.4): with a stale one a revocation that
 * delivery withheld would go unnoticed. `--allow-stale-revocations` is the operator's explicit
 * decision; it is warned about and recorded by `recordStaleRevocations`.
 */
export function refuseStaleRevocations(reason: string | null, allowed: boolean): void {
  if (reason !== null && !allowed)
    throw new Error(
      `No current module revocation list (stale_revocations): ${reason}; store a newer one with arkvory module revocations <file>, or repeat with --allow-stale-revocations`,
    );
}

export interface StaleUse {
  readonly command: 'install' | 'pin';
  readonly module: string;
  readonly version: string;
}

/**
 * Prints the warning and appends one line to `modules/audit.jsonl` (owner only and the service
 * group, 0640): who went on with which list, when, for which module.
 */
export async function recordStaleRevocations(
  root: string,
  list: RevocationList | null,
  use: StaleUse,
  context: ModuleCommandContext,
): Promise<void> {
  const reason = staleRevocations(list, context.now()) ?? 'stale';
  context.print(
    `Warning: ${use.command === 'install' ? 'installing' : 'pinning'} with a stale revocation list (${reason}); versions revoked since may not be known on this host`,
  );
  const by = `${userInfo().username}@${hostname()}`.replace(/\p{Cc}/gu, '').slice(0, 128);
  const line = JSON.stringify({
    at: new Date(context.now()).toISOString(),
    event: 'stale_revocations_allowed',
    ...use,
    sequence: list?.sequence ?? null,
    expiresAt: list?.expiresAt ?? null,
    by,
  });
  const file = await open(moduleLayout(root).audit, 'a', 0o640);
  try {
    await file.writeFile(`${line}
`);
    await file.sync();
  } finally {
    await file.close();
  }
}

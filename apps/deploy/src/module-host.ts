import { stat } from 'node:fs/promises';
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

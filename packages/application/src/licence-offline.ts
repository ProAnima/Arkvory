import { LICENCE_LOCK_WAIT_MS, licenceIso } from './licence-exchange.js';
import { LicenceDocumentRefused } from './licence-ports.js';
import type { LicenceEnvironment, LicenceModuleRef, LicenceSignal } from './licence-ports.js';

/**
 * Offline activation (ADR 0078, R2) for closed networks and `--hub-off`: the core writes a
 * request file and later installs the signed answer; it never goes to the network for either.
 * Licence revocation lists brought by the operator are installed the same way.
 */
export interface OfflineLicenceRequest {
  readonly format: 1;
  readonly kind: 'arkvory-licence-request';
  readonly installId: string;
  readonly coreVersion: string;
  readonly modules: readonly LicenceModuleRef[];
  readonly requestedAt: string;
  readonly nonce: string;
  /** SHA-256 of the normalised licence key instead of the key: the file holds no secret. */
  readonly keySha256: string;
}

type OfflineEnvironment = Pick<
  LicenceEnvironment,
  'store' | 'verifier' | 'nonce' | 'coreVersion' | 'modules'
>;

export type LicenceInstallResult =
  | {
      readonly outcome: 'installed';
      readonly activationId: string;
      readonly licenceId: string;
      readonly notAfter: number;
    }
  | { readonly outcome: 'list'; readonly number: number; readonly changed: boolean }
  | { readonly outcome: 'refused'; readonly code: string }
  | { readonly outcome: 'busy' };

/** `arkvory license request`: the pending request is kept until its answer is installed. */
export async function createOfflineRequest(
  env: OfflineEnvironment,
  input: { readonly keySha256: string; readonly installation: string },
): Promise<OfflineLicenceRequest> {
  const nonce = env.nonce();
  const now = await env.store.databaseNow();
  await env.store.saveRequest({
    nonce,
    installation: input.installation,
    keySha256: input.keySha256,
    createdAt: now,
  });
  return {
    format: 1,
    kind: 'arkvory-licence-request',
    installId: input.installation,
    coreVersion: env.coreVersion,
    modules: await env.modules(),
    requestedAt: licenceIso(now),
    nonce,
    keySha256: input.keySha256,
  };
}

async function installOffline(
  env: OfflineEnvironment,
  text: string,
  installation: string,
): Promise<LicenceInstallResult> {
  const token = env.verifier.token(text, 'offline-activation');
  const request = await env.store.request(token.nonce);
  if (request === null) return { outcome: 'refused', code: 'nonce_unknown' };
  if (token.installation !== installation || request.installation !== installation)
    return { outcome: 'refused', code: 'installation_mismatch' };
  const kept = await env.store.activation(token.activationId);
  if (kept !== null && token.seq <= kept.seq) return { outcome: 'refused', code: 'seq_replayed' };
  const saved = await env.store.saveToken({
    activationId: token.activationId,
    licenceId: token.licenceId,
    installation: token.installation,
    activation: 'offline',
    token: text,
    seq: token.seq,
    issuedAt: token.issuedAt,
    refreshAfter: token.refreshAfter,
    notAfter: token.notAfter,
    // An offline activation has no refresh: a new request extends it.
    nextAttemptAt: null,
  });
  if (saved === 'stale') return { outcome: 'refused', code: 'seq_replayed' };
  await env.store.removeRequest(token.nonce);
  return {
    outcome: 'installed',
    activationId: token.activationId,
    licenceId: token.licenceId,
    notAfter: token.notAfter,
  };
}

async function installList(
  env: Pick<LicenceEnvironment, 'store' | 'verifier'>,
  text: string,
): Promise<LicenceInstallResult> {
  const list = env.verifier.revocationList(text);
  const saved = await env.store.saveRevocationList(list.number, text);
  if (saved === 'stale') return { outcome: 'refused', code: 'revocation_rollback' };
  if (saved === 'conflict') return { outcome: 'refused', code: 'revocation_conflict' };
  return { outcome: 'list', number: list.number, changed: saved === 'saved' };
}

/**
 * `arkvory license install <file>`: an offline activation that answers a pending request of this
 * installation, or a licence revocation list not older than the kept one.
 */
export async function installLicenceDocument(
  env: OfflineEnvironment,
  text: string,
  installation: string,
): Promise<LicenceInstallResult> {
  const outcome = await env.store.exclusive(async (): Promise<LicenceInstallResult> => {
    try {
      const kind = env.verifier.kind(text);
      if (kind === 'offline-activation') return await installOffline(env, text, installation);
      if (kind === 'revocation-list') return await installList(env, text);
      return { outcome: 'refused', code: 'document_kind' };
    } catch (error) {
      if (!(error instanceof LicenceDocumentRefused)) throw error;
      return { outcome: 'refused', code: `${error.failure}_${error.code}` };
    }
  }, LICENCE_LOCK_WAIT_MS);
  return outcome === 'busy' ? { outcome: 'busy' } : outcome;
}

/**
 * The hub's latest licence revocation list, asked with the refreshes and only while the
 * installation has an activation.
 */
export async function updateLicenceRevocations(
  env: Pick<LicenceEnvironment, 'store' | 'verifier' | 'hub'>,
  signal?: LicenceSignal,
): Promise<LicenceInstallResult | null> {
  if ((await env.store.activations()).length === 0) return null;
  const kept = await env.store.revocationList();
  const text = await env.hub.revocations(kept?.number ?? 0, signal);
  if (text === null) return null;
  try {
    return await installList(env, text);
  } catch (error) {
    if (!(error instanceof LicenceDocumentRefused)) throw error;
    return { outcome: 'refused', code: `${error.failure}_${error.code}` };
  }
}

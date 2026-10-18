/**
 * Ports of licence activation (ADR 0078, R2). The free core never calls any of them on its own:
 * the hub is asked only for activations an administrator made with `arkvory license activate`.
 * No port carries the licence key beyond the activation request, and no port logs a secret.
 */

/** The part of an AbortSignal licence exchanges pass on; the core has no DOM or Node globals. */
export interface LicenceSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** An installed paid module as activation and refresh requests name it. */
export interface LicenceModuleRef {
  readonly id: string;
  readonly version: string;
}

/** The body of `POST /v1/{project}/licence/activate`, exactly (ADR 0078, R2). */
export interface LicenceActivateBody {
  readonly key: string;
  readonly installId: string;
  readonly nonce: string;
  readonly coreVersion: string;
  readonly modules: readonly LicenceModuleRef[];
  readonly requestedAt: string;
}

/** The body of `POST /v1/{project}/licence/refresh`, exactly. */
export interface LicenceRefreshBody {
  readonly activationId: string;
  readonly activationSecret: string;
  readonly nonce: string;
  readonly seq: number;
  readonly coreVersion: string;
  readonly modules: readonly LicenceModuleRef[];
}

/** Transport failures; `sent` tells whether the request may have reached the hub. */
export type LicenceTransportFailure =
  'unreachable' | 'timeout' | 'tls_failed' | 'hub_error' | 'answer_invalid' | 'hub_off';

export type LicenceHubAnswer =
  | {
      readonly kind: 'issued';
      readonly token: string;
      readonly activationSecret: string;
      readonly activationId: string;
    }
  | { readonly kind: 'revoked'; readonly revocation: string }
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly code: string;
      readonly retryAfterMs: number | null;
    }
  | {
      readonly kind: 'failed';
      readonly failure: LicenceTransportFailure;
      readonly sent: boolean;
      readonly retryAfterMs: number | null;
    };

export type LicenceHubOutcome =
  { readonly kind: 'done' } | Extract<LicenceHubAnswer, { kind: 'refused' } | { kind: 'failed' }>;

/** The hub's licence calls; implemented over TLS with certificate verification. */
export interface LicenceHub {
  activate(body: LicenceActivateBody, signal?: LicenceSignal): Promise<LicenceHubAnswer>;
  refresh(body: LicenceRefreshBody, signal?: LicenceSignal): Promise<LicenceHubAnswer>;
  deactivate(
    body: { readonly activationId: string; readonly activationSecret: string },
    signal?: LicenceSignal,
  ): Promise<LicenceHubOutcome>;
  /** The latest licence revocation list above `after`, or null. */
  revocations(after: number, signal?: LicenceSignal): Promise<string | null>;
}

/** The current secret of an activation and the `seq` of the token issued with it. */
export interface ActivationSecret {
  readonly secret: string;
  readonly seq: number;
}

/**
 * Secrets of activations: files outside the database, logs and backups, readable only by the
 * service account (ADR 0078, R2). `write` replaces atomically, so a reader sees the old or the
 * new secret, never a mixture.
 */
export interface ActivationSecrets {
  read(activationId: string): Promise<ActivationSecret | null>;
  write(activationId: string, secret: ActivationSecret): Promise<void>;
  remove(activationId: string): Promise<void>;
}

/** A token, statement or list the verifier accepted, with the facts the core needs. */
export interface VerifiedLicenceToken {
  readonly kind: 'activation' | 'offline-activation';
  readonly licenceId: string;
  readonly activationId: string;
  readonly installation: string;
  readonly type: string;
  readonly licensee: string;
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, string>>;
  readonly issuedAt: number;
  readonly refreshAfter: number;
  readonly notAfter: number;
  readonly licenceNotAfter: number | null;
  readonly graceDays: number;
  readonly updatesUntil: number | null;
  readonly seq: number;
  readonly nonce: string;
  /** Id of the delegated key that signed. */
  readonly signer: string;
}
export interface VerifiedLicenceRevocation {
  readonly licenceId: string;
  readonly activationId: string;
  readonly installation: string;
  readonly reason: string;
  readonly issuedAt: number;
  readonly seq: number;
  readonly nonce: string;
}
export interface VerifiedRevocationList {
  readonly number: number;
  readonly licences: ReadonlyMap<string, string>;
  readonly certificates: ReadonlySet<string>;
}

/** Refusal of a document; `failure` is the class of the hub's golden vectors. */
export class LicenceDocumentRefused extends Error {
  override readonly name = 'LicenceDocumentRefused';
  constructor(
    readonly failure: string,
    readonly code: string,
  ) {
    super(`Licence document refused: ${failure}/${code}`);
  }
}

/** Verifies documents with the built-in licence root; throws LicenceDocumentRefused. */
export interface LicenceVerifier {
  token(text: string, kind: VerifiedLicenceToken['kind']): VerifiedLicenceToken;
  revocation(text: string): VerifiedLicenceRevocation;
  revocationList(text: string): VerifiedRevocationList;
  /** The untrusted kind of a document, only to choose its verifier. */
  kind(text: string): string | null;
}

/** One stored activation; `token` and `revocation` are exact envelope texts. */
export interface StoredActivation {
  readonly activationId: string;
  readonly licenceId: string;
  readonly activation: 'online' | 'offline';
  readonly token: string;
  readonly seq: number;
  readonly revocation: string | null;
  readonly pendingNonce: string | null;
  readonly pendingSeq: number | null;
  readonly pendingSince: number | null;
  readonly lastRefreshAt: number | null;
  readonly failure: string | null;
  readonly failures: number;
  readonly nextAttemptAt: number | null;
  readonly mismatchSince: number | null;
}

/** A token to keep; refused as `stale` unless its `seq` is above every document kept. */
export interface LicenceTokenRecord {
  readonly activationId: string;
  readonly licenceId: string;
  readonly installation: string;
  readonly activation: 'online' | 'offline';
  readonly token: string;
  readonly seq: number;
  readonly issuedAt: number;
  readonly refreshAfter: number;
  readonly notAfter: number;
  readonly nextAttemptAt: number | null;
}

/** An offline activation request waiting for its answer (no secret in it). */
export interface LicenceRequestRecord {
  readonly nonce: string;
  readonly installation: string;
  readonly keySha256: string;
  readonly createdAt: number;
}

/** What the database keeps of licences (`arkvory_license_*`, part of a backup but secrets). */
export interface LicenceStore {
  databaseNow(): Promise<number>;
  /**
   * The highest time and the installation id the writer recorded, and the latest `issuedAt` of a
   * kept document.
   */
  clock(): Promise<{
    readonly maxSeen: number | null;
    readonly installation: string | null;
    readonly maxIssued: number | null;
  }>;
  /** The writer records the database's time and its installation id; marks mismatches. */
  observe(installation: string | null): Promise<void>;
  activations(): Promise<readonly StoredActivation[]>;
  activation(activationId: string): Promise<StoredActivation | null>;
  saveToken(record: LicenceTokenRecord): Promise<'saved' | 'stale'>;
  saveRevocation(
    activationId: string,
    text: string,
    seq: number,
    issuedAt: number,
  ): Promise<'saved' | 'stale'>;
  /** Records the nonce of an attempt before it is sent, so a retry can repeat it. */
  startAttempt(activationId: string, nonce: string, seq: number): Promise<void>;
  recordFailure(activationId: string, failure: string, nextAttemptAt: number | null): Promise<void>;
  remove(activationId: string): Promise<void>;
  revocationList(): Promise<{ readonly number: number; readonly text: string } | null>;
  /** Keeps a higher list; the same number with other bytes is a `conflict`. */
  saveRevocationList(
    number: number,
    text: string,
  ): Promise<'saved' | 'unchanged' | 'stale' | 'conflict'>;
  saveRequest(request: LicenceRequestRecord): Promise<void>;
  request(nonce: string): Promise<LicenceRequestRecord | null>;
  pendingRequests(): Promise<number>;
  removeRequest(nonce: string): Promise<void>;
  /**
   * Runs `work` alone among the installation's licence exchanges: two refreshes with one secret
   * would look like a cloned installation to the hub. Waits at most `waitMs`, then `busy`.
   */
  exclusive<T>(work: () => Promise<T>, waitMs: number): Promise<T | 'busy'>;
}

/** Clock-free dependencies of the licence use cases. */
export interface LicenceEnvironment {
  readonly hub: LicenceHub;
  readonly secrets: ActivationSecrets;
  readonly store: LicenceStore;
  readonly verifier: LicenceVerifier;
  /** A random request nonce of 128 bits or more, `[A-Za-z0-9_-]`. */
  readonly nonce: () => string;
  /** A number in [0, 1) for the spread of retries. */
  readonly random: () => number;
  readonly sleep: (ms: number, signal?: LicenceSignal) => Promise<void>;
  readonly coreVersion: string;
  readonly modules: () => Promise<readonly LicenceModuleRef[]>;
}

import { ArkvoryClientError, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient, ClientErrorCode, RequestEvent } from '@proanima/arkvory-sdk';
import type { LegacyClient, LegacyConstructor } from './sdk-legacy.js';

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Signature<T> = T extends (...args: infer P) => infer R ? [P, R] : never;
type ChangedMethods = {
  [K in keyof LegacyClient]: Equal<
    Signature<LegacyClient[K]>,
    Signature<ArkvoryClient[K]>
  > extends true
    ? never
    : K;
}[keyof LegacyClient];

// ADR 0041 adds an optional AbortSignal to registerPackage; ADR 0046 adds part layout limits to
// capabilities and ADR 0079 its optional modules. Existing invocations and reads remain assignable.
// ADR 0047 widens deletion blockers (promotion_stage) and permission names (artifact.promote);
// exhaustive consumers of these values must handle the additions.
type Widened =
  | 'inspectDeletion'
  | 'deleteArtifact'
  | 'previewStoragePolicy'
  | 'runStoragePolicy'
  | 'previewRetention'
  | 'applyRetention'
  | 'repositories'
  | 'repository';
export type ExistingCallsRemainValid = Assert<
  Omit<ArkvoryClient, Widened> extends Omit<LegacyClient, Widened> ? true : false
>;
type Blocker<T> = T extends {
  inspectDeletion(...args: never[]): Promise<{ blockers: readonly (infer B)[] }>;
}
  ? B
  : never;
export type WidenedBlockers = Assert<
  Equal<Exclude<Blocker<ArkvoryClient>, Blocker<LegacyClient>>, 'promotion_stage'>
>;
// Compile against built package exports, as an external strict TypeScript consumer does.
// search items additionally carry size, createdAt, publishedAt, labels and stages: additive
// response fields, so existing reads of id/name remain assignable (ExistingCallsRemainValid).
export type UnchangedMethods = Assert<
  Equal<ChangedMethods, 'registerPackage' | 'capabilities' | 'search' | Widened>
>;
export type UnchangedKeys = Assert<
  Equal<
    Exclude<
      keyof ArkvoryClient,
      | 'identity'
      | 'administration'
      | 'updates'
      | 'inRepository'
      | 'cleanup'
      | 'configureCleanup'
      | 'requestCleanup'
      | 'register'
      | 'tokens'
      | 'createToken'
      | 'revokeToken'
      | 'promotions'
      // ADR 0049: public sign-in options, account token administration and the security journal.
      | 'authOptions'
      | 'accountTokens'
      | 'revokeAccountToken'
      | 'securityAudit'
      // ADR 0056: instance backups as the additive namespace `backup`.
      | 'backup'
      // ADR 0058: the repository change feed that mirrors follow and the mirror status.
      | 'catalogChanges'
      | 'repositoryMirror'
      // ADR 0058: every mirror and import the caller can see, for the console's Mirrors page.
      | 'mirrors'
      // ADR 0060: feedback to ProAnimaStudio as the additive namespace `feedback`.
      | 'feedback'
      // ADR 0062: short-lived download links.
      | 'createDownloadLink'
      // ADR 0064: raw files by path as the additive namespace `raw`.
      | 'raw'
      // ADR 0072: HA cluster copies from readiness as the additive namespace `replication`.
      | 'replication'
      // ADR 0077: sites, pairing and topology as the additive namespace `fleet`.
      | 'fleet'
      | 'downloadSettings'
      | 'siteChanges'
      // ADR 0080: the installation's event feed as the additive namespace `events`.
      | 'events'
      // ADR 0081 (A1): search across every repository the credential may list.
      | 'searchAll'
      // ADR 0078/0079: the installation's modules as the additive namespace `system`.
      | 'system'
    >,
    keyof LegacyClient
  >
>;
// ADR 0051 adds the optional ClientOptions.onRequest observer; options stay mutually assignable.
export type UnchangedConstructor = Assert<
  Equal<ConstructorParameters<typeof ArkvoryClient>, ConstructorParameters<LegacyConstructor>>
>;
export type ObserverIsOptional = Assert<
  Equal<
    NonNullable<NonNullable<ConstructorParameters<typeof ArkvoryClient>[2]>['onRequest']>,
    (event: RequestEvent) => void
  >
>;
// ADR 0081 adds the optional ClientOptions.clientName (the Arkvory-Client header).
export type ClientNameIsOptional = Assert<
  Equal<
    NonNullable<ConstructorParameters<typeof ArkvoryClient>[2]>['clientName'],
    string | undefined
  >
>;

// ADR 0051: ArkvoryHttpError keeps its constructor and fields and adds serverMessage, reason,
// details and retryAfterSeconds; local failures become ArkvoryClientError, still an Error with
// the previous message text. Exhaustive consumers of `code` must tolerate new values.
// ADR 0076 adds `queue`: the place of a download in the server's queue (503 download_queued).
// ADR 0080 adds `events`: the event feed window of 410 events_cursor_expired and 409 epochs.
interface LegacyHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly retryAfterMs?: number | undefined;
}
export type HttpErrorStillReadable = Assert<
  ArkvoryHttpError extends LegacyHttpError ? true : false
>;
export type HttpErrorAdditions = Assert<
  Equal<
    Exclude<keyof ArkvoryHttpError, keyof LegacyHttpError>,
    'serverMessage' | 'reason' | 'details' | 'retryAfterSeconds' | 'queue' | 'events'
  >
>;
export type ClientErrorIsError = Assert<ArkvoryClientError extends Error ? true : false>;
export type ClientErrorCodes = Assert<
  Equal<
    ClientErrorCode,
    | 'invalid_argument'
    | 'insecure_url'
    | 'invalid_response'
    | 'response_too_large'
    | 'size_mismatch'
    | 'file_changed'
    | 'upload_cancelled'
    | 'completion_failed'
    // ADR 0076: a download the server's queue would start after the caller's notAfter.
    | 'queue_deadline'
  >
>;
export function legacyHttpError(): Error {
  return new ArkvoryHttpError(503, 'busy', 'request', 2000);
}

export function metadataSearch(client: ArkvoryClient, signal: AbortSignal) {
  void client.search('releases', { metadataKey: 'commit', metadataValue: 'abc' });
  void client.registerPackage('releases', 'artifact', signal);
}

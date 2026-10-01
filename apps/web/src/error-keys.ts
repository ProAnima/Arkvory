import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
  DownloadQueueError,
} from '@proanima/arkvory-sdk';
import type { ClientErrorCode } from '@proanima/arkvory-sdk';
import type { MessageKey } from './messages.js';

/** How the page authenticated; the same 401 reads differently for a session and for a key. */
export type Credential = 'none' | 'session' | 'key';
export interface FieldProblem {
  readonly field: string;
  readonly problem: string;
}

/** Errors raised by the console itself; `fields` marks the inputs to highlight. */
export class UiError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly fields: readonly FieldProblem[] = [],
  ) {
    super(key);
  }
}

// Reason first: the closed per-code sets of ADR 0051. Unknown reasons fall back to the code.
const byReason: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  invalid_input: {
    body_too_large: 'errorBodyTooLarge',
    unsupported_media_type: 'errorMediaType',
    malformed_json: 'errorMalformed',
    method_not_allowed: 'errorRouteMissing',
    range_not_satisfiable: 'errorRange',
  },
  not_found: { route_not_found: 'errorRouteMissing' },
  conflict: {
    upload_expired: 'errorUploadExpired',
    upload_state: 'errorUploadState',
    revision_mismatch: 'errorRevisionMismatch',
    version_exists: 'errorVersionExists',
    part_mismatch: 'mismatch',
    parts_incomplete: 'errorPartsIncomplete',
    idempotency_mismatch: 'errorIdempotency',
    already_exists: 'errorAlreadyExists',
    stage_limit: 'errorStageLimit',
  },
  forbidden: {
    read_only_token: 'errorReadOnlyToken',
    credential_revoked: 'errorCredentialRevoked',
    session_required: 'errorSessionRequired',
    administrator_required: 'errorAdministratorRequired',
    registration_disabled: 'errorRegistrationDisabled',
    origin_not_allowed: 'errorOriginForbidden',
  },
  capacity_exceeded: {
    storage_quota: 'errorStorageQuota',
    storage_full: 'errorStorageFull',
    account_limit: 'errorAccountLimit',
    group_limit: 'errorGroupLimit',
    membership_limit: 'errorMembershipLimit',
    grant_limit: 'errorGrantLimit',
    key_limit: 'errorKeyLimit',
    token_limit: 'errorTokenLimit',
    delegation_limit: 'errorDelegationLimit',
    catalog_limit: 'errorCatalogLimit',
    queue_full: 'errorQueueFull',
    transfer_limit: 'errorTransferLimit',
  },
  rate_limited: {
    login_attempts: 'errorRateLimited',
    registration_attempts: 'errorRegistrationLimited',
    password_attempts: 'errorPasswordLimited',
  },
};
const byCode: Readonly<Record<string, MessageKey>> = {
  invalid_input: 'errorInput',
  not_found: 'errorNotFound',
  conflict: 'errorConflict',
  forbidden: 'errorForbidden',
  capacity_exceeded: 'errorCapacity',
  integrity_mismatch: 'errorIntegrity',
  busy: 'errorBusy',
  unavailable: 'errorUnavailable',
  rate_limited: 'errorTooManyRequests',
  read_only: 'errorReadOnly',
  internal: 'errorInternal',
};
// Answers without the native envelope, typically from a proxy, are read by status only.
const byStatus: Readonly<Record<number, MessageKey>> = {
  400: 'errorInput',
  403: 'errorForbidden',
  404: 'errorNotFound',
  405: 'errorRouteMissing',
  409: 'errorConflict',
  413: 'errorBodyTooLarge',
  415: 'errorMediaType',
  416: 'errorRange',
  422: 'errorIntegrity',
  429: 'errorTooManyRequests',
  500: 'errorInternal',
  502: 'errorGateway',
  503: 'errorBusy',
  504: 'errorGateway',
  507: 'errorCapacity',
};
const clientKeys: Readonly<Record<ClientErrorCode, MessageKey>> = {
  invalid_argument: 'errorInput',
  insecure_url: 'apiAddressError',
  invalid_response: 'errorUnexpectedResponse',
  response_too_large: 'errorUnexpectedResponse',
  size_mismatch: 'mismatch',
  file_changed: 'mismatch',
  upload_cancelled: 'errorUploadState',
  completion_failed: 'errorCompletionFailed',
};

/** 401: the typed password, the page credential, or the request's lack of one. */
function unauthorizedKey(error: ArkvoryHttpError, credential: Credential): MessageKey {
  if (error.reason === 'invalid_credentials') return 'signInFailed';
  if (error.reason === 'current_password_invalid') return 'currentPasswordWrong';
  if (credential === 'none' || error.reason === 'credential_missing') return 'errorSignInRequired';
  if (error.reason === 'token_expired') return 'errorTokenExpired';
  if (credential === 'session')
    return error.reason === 'credential_invalid' ? 'sessionEnded' : 'sessionExpired';
  return 'errorUnauthorized';
}

function httpKey(error: ArkvoryHttpError, credential: Credential): MessageKey {
  if (error.status === 401) return unauthorizedKey(error, credential);
  const reasonKey = error.reason ? byReason[error.code]?.[error.reason] : undefined;
  if (reasonKey) return reasonKey;
  if (error.code === 'invalid_input' && error.details.length) return 'errorFields';
  // A gateway status wins over a code only when the native envelope is absent.
  if (error.code === 'http_error') return byStatus[error.status] ?? 'errorGeneric';
  return byCode[error.code] ?? byStatus[error.status] ?? 'errorGeneric';
}

/** The message for any failure the console can meet; never inspects error text. */
export function describeError(error: unknown, credential: Credential): MessageKey {
  if (error instanceof DownloadQueueError)
    return error.code === 'wait_timeout'
      ? 'downloadWaitTimeout'
      : error.code === 'queue_full'
        ? 'downloadQueueFull'
        : 'errorInput';
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'downloadDiskFull';
  if (error instanceof UiError) return error.key;
  if (error instanceof ArkvoryIntegrityError) return 'errorIntegrity';
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'errorTimeout';
  if (error instanceof ArkvoryNetworkError) return 'errorNetwork';
  if (error instanceof ArkvoryClientError) return clientKeys[error.code];
  if (error instanceof ArkvoryHttpError) return httpKey(error, credential);
  return 'errorGeneric';
}

/** Request ID and Retry-After a person can act on or quote; both absent for local failures. */
export function errorReference(error: unknown): {
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
} {
  if (!(error instanceof ArkvoryHttpError)) return {};
  const seconds = error.retryAfterSeconds;
  return {
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(seconds !== undefined && seconds > 0 ? { retryAfterSeconds: seconds } : {}),
  };
}

/** Inputs named by the server (`details`) or by console validation. */
export function fieldProblems(error: unknown): readonly FieldProblem[] {
  if (error instanceof UiError) return error.fields;
  if (error instanceof ArkvoryHttpError) return error.details;
  return [];
}

/** A 401 that is about the page credential, not about a password typed into a form. */
export function credentialRejected(error: unknown): error is ArkvoryHttpError {
  return (
    error instanceof ArkvoryHttpError &&
    error.status === 401 &&
    error.reason !== 'invalid_credentials' &&
    error.reason !== 'current_password_invalid'
  );
}

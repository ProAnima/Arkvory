/**
 * Machine error contract (ADR 0051). The code is coarse and stable; the optional reason refines
 * it from a closed per-code set. Wire readers must still tolerate reasons added later.
 */
export const errorReasons = {
  invalid_input: [
    'validation',
    'malformed_json',
    'body_too_large',
    'unsupported_media_type',
    'method_not_allowed',
    'range_not_satisfiable',
  ],
  not_found: ['route_not_found'],
  conflict: [
    'upload_expired',
    'upload_state',
    'revision_mismatch',
    'version_exists',
    'part_mismatch',
    'parts_incomplete',
    'idempotency_mismatch',
    'already_exists',
    'stage_limit',
    'state_conflict',
  ],
  forbidden: [
    'permission_missing',
    'read_only_token',
    'credential_revoked',
    'session_required',
    'administrator_required',
    'registration_disabled',
    'origin_not_allowed',
  ],
  unauthorized: [
    'invalid_credentials',
    'current_password_invalid',
    'credential_missing',
    'credential_invalid',
    'session_expired',
    'token_expired',
  ],
  capacity_exceeded: [
    'storage_quota',
    'storage_full',
    'account_limit',
    'group_limit',
    'membership_limit',
    'grant_limit',
    'key_limit',
    'token_limit',
    'delegation_limit',
    'catalog_limit',
    'queue_full',
    'transfer_limit',
  ],
  integrity_mismatch: [],
  busy: ['request_limit'],
  unavailable: [],
  rate_limited: ['login_attempts', 'registration_attempts', 'password_attempts'],
  read_only: [],
  /** Unclassified server defect: 500 without Retry-After; clients must not retry blindly. */
  internal: [],
} as const;
export type ErrorCode = keyof typeof errorReasons;
export const errorCodes: readonly ErrorCode[] = Object.keys(errorReasons).filter(
  (key): key is ErrorCode => Object.hasOwn(errorReasons, key),
);
export type ErrorReasonOf<C extends ErrorCode> = (typeof errorReasons)[C][number];
export type ErrorReason = ErrorReasonOf<ErrorCode>;

/** What is wrong with one input; the field names its location (ADR 0051). */
export const detailProblems = [
  'required',
  'unknown_field',
  'type',
  'format',
  'length',
  'range',
  'invalid',
] as const;
export type DetailProblem = (typeof detailProblems)[number];
/**
 * `field` is a JSON Pointer into the request body (`/name`, `/policy/quotaBytes`) or the bare
 * name of a path or query parameter (`stage`). It never carries the offending value.
 */
export interface ErrorDetail {
  readonly field: string;
  readonly problem: DetailProblem;
}
export const MAX_ERROR_DETAILS = 16;

export interface ErrorExtra<C extends ErrorCode> {
  readonly reason?: ErrorReasonOf<C>;
  readonly details?: readonly ErrorDetail[];
  /** Safe to disclose; the HTTP layer mirrors it in Retry-After. */
  readonly retryAfterSeconds?: number;
}
// One tuple per code correlates the code with its own reasons at every call site.
type ErrorArguments = {
  [C in ErrorCode]: [code: C, message: string, extra?: ErrorExtra<C>];
}[ErrorCode];

export class ArkvoryError extends Error {
  readonly code: ErrorCode;
  readonly reason: ErrorReason | undefined;
  readonly details: readonly ErrorDetail[];
  readonly retryAfterSeconds: number | undefined;
  constructor(...[code, message, extra]: ErrorArguments) {
    super(message);
    this.name = 'ArkvoryError';
    this.code = code;
    this.reason = extra?.reason;
    this.details = (extra?.details ?? []).slice(0, MAX_ERROR_DETAILS);
    const seconds = extra?.retryAfterSeconds;
    this.retryAfterSeconds =
      seconds === undefined
        ? undefined
        : Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  }
}

export function isErrorReason(code: ErrorCode, reason: string): boolean {
  const known: readonly string[] = errorReasons[code];
  return known.includes(reason);
}

/** A validation failure of one named input. */
export function fieldError(field: string, problem: DetailProblem, message: string): ArkvoryError {
  return new ArkvoryError('invalid_input', message, {
    reason: 'validation',
    details: [{ field, problem }],
  });
}

/** Rebases field pointers of a nested parser onto its member, e.g. `/quotaBytes` → `/policy/…`. */
export function nestedFields<T>(prefix: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (
      error instanceof ArkvoryError &&
      error.code === 'invalid_input' &&
      error.details.length &&
      (error.reason === undefined || error.reason === 'validation')
    )
      throw new ArkvoryError('invalid_input', error.message, {
        reason: 'validation',
        details: error.details.map((detail) => ({
          ...detail,
          field: detail.field === '/' ? prefix : prefix + detail.field,
        })),
      });
    throw error;
  }
}

/**
 * Names the input whose validator failed. Validators stay unaware of wire field names; the
 * caller that maps a request field to a value supplies the location.
 */
export function withField<T>(field: string, validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof ArkvoryError && error.code === 'invalid_input' && !error.details.length)
      throw new ArkvoryError('invalid_input', error.message, {
        reason: 'validation',
        details: [{ field, problem: 'invalid' }],
      });
    throw error;
  }
}

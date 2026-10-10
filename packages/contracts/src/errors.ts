import { record } from './wire-values.js';

/**
 * Wire error contract (ADR 0051); the single source of the error schema. The set mirrors the
 * domain contract, kept separate because contracts never depend on domain (checked by tests).
 * Clients must treat unknown codes as their HTTP status class and unknown reasons as absent.
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
    'mirror_read_only',
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
  unavailable: ['feedback_disabled', 'hub_unreachable', 'replication_degraded'],
  rate_limited: [
    'login_attempts',
    'registration_attempts',
    'password_attempts',
    'feedback_attempts',
  ],
  read_only: [],
  internal: [],
} as const;
export type ErrorCodeName = keyof typeof errorReasons;
export type ErrorReasonName = (typeof errorReasons)[ErrorCodeName][number];
export const errorCodes: readonly ErrorCodeName[] = Object.keys(errorReasons).filter(
  (key): key is ErrorCodeName => Object.hasOwn(errorReasons, key),
);
export const detailProblems = [
  'required',
  'unknown_field',
  'type',
  'format',
  'length',
  'range',
  'invalid',
] as const;
export const maxErrorDetails = 16;
const maxFieldLength = 256;
const maxMessageLength = 1024;
const machineName = '^[a-z][a-z0-9_]{0,63}$';

export interface ErrorDetailResponse {
  readonly field: string;
  readonly problem: string;
}
/** `code`, `message` and `requestId` are always present; the rest is additive (ADR 0051). */
export interface NativeErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly reason?: string;
  readonly details?: readonly ErrorDetailResponse[];
  readonly retryAfterSeconds?: number;
}

const reasonList = Object.entries(errorReasons)
  .filter(([, reasons]) => reasons.length > 0)
  .map(([code, reasons]) => `${code}: ${reasons.join(', ')}`)
  .join('; ');
export const nativeErrorSchema = {
  type: 'object',
  required: ['code', 'message', 'requestId'],
  properties: {
    code: {
      type: 'string',
      enum: errorCodes,
      description: 'Stable machine code. Treat an unknown future code by its HTTP status class.',
    },
    message: {
      type: 'string',
      maxLength: maxMessageLength,
      description: 'Fixed English text for operators; not localized, never parse it.',
    },
    requestId: { type: 'string', description: 'Equals the X-Request-Id response header.' },
    reason: {
      type: 'string',
      pattern: machineName,
      description: `Optional refinement of code. Known values — ${reasonList}. Readers must tolerate unknown values.`,
    },
    details: {
      type: 'array',
      maxItems: maxErrorDetails,
      description: 'Inputs that failed validation; never contains the submitted values.',
      items: {
        type: 'object',
        required: ['field', 'problem'],
        properties: {
          field: {
            type: 'string',
            maxLength: maxFieldLength,
            description: 'JSON Pointer into the request body, or a path/query parameter name.',
          },
          problem: {
            type: 'string',
            pattern: machineName,
            description: `Known values: ${detailProblems.join(', ')}.`,
          },
        },
      },
    },
    retryAfterSeconds: {
      type: 'integer',
      minimum: 0,
      description: 'Present with Retry-After (429, 503): seconds before a retry may succeed.',
    },
  },
} as const;
const header = (description: string) => ({ description, schema: { type: 'string' } });
export const requestIdHeader = header('Server-generated request ID.');
export const nativeErrorResponse = {
  description: 'Native error envelope; no stack traces or credentials.',
  headers: { 'X-Request-Id': requestIdHeader },
  content: { 'application/json': { schema: nativeErrorSchema } },
};
export const retryAfterHeader = header('Delay in seconds; equals retryAfterSeconds.');

function boundedText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value : undefined;
}
function machine(value: unknown): string | undefined {
  return typeof value === 'string' && new RegExp(machineName).test(value) ? value : undefined;
}
function readDetails(value: unknown): readonly ErrorDetailResponse[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  const result: ErrorDetailResponse[] = [];
  for (const item of items.slice(0, maxErrorDetails)) {
    if (typeof item !== 'object' || item === null) continue;
    const entry: Record<string, unknown> = Object.fromEntries(Object.entries(item));
    const field = boundedText(entry['field'], maxFieldLength);
    const problem = machine(entry['problem']);
    if (field !== undefined && problem !== undefined) result.push({ field, problem });
  }
  return result;
}

/**
 * Lenient reader for clients: unknown codes and reasons are kept as text, malformed optional
 * members are dropped. Throws only when the mandatory envelope is absent.
 */
export function readNativeError(value: unknown): NativeErrorResponse {
  const row = record(value);
  const code = machine(row['code']);
  if (code === undefined) throw new Error('Invalid server error code');
  const reason = machine(row['reason']);
  const details = readDetails(row['details']);
  const seconds = row['retryAfterSeconds'];
  return {
    code,
    message: boundedText(row['message'], maxMessageLength) ?? '',
    requestId: boundedText(row['requestId'], 128) ?? '',
    ...(reason === undefined ? {} : { reason }),
    ...(details.length ? { details } : {}),
    ...(typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 0
      ? { retryAfterSeconds: seconds }
      : {}),
  };
}

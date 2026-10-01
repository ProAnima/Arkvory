import { ArkvoryError } from '@proanima/arkvory-domain';

/** Only constant identifiers from an error; never its message, stack, URL or parameters. */
export interface FailureCause {
  readonly errorName: string;
  readonly errno?: string;
  readonly sqlstate?: string;
}
/** cancelled: an AbortSignal fired (client gone, shutdown or a bounded timeout), not a defect. */
export type FailureKind = 'storage_full' | 'dependency_unavailable' | 'cancelled' | 'unexpected';

// SQLSTATE class 08 (connection exception) is matched by prefix.
const unavailableStates = new Set([
  '40001', // serialization_failure: transaction rolled back, safe to retry the request
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '57014', // query_canceled, including statement_timeout under load
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);
const unavailableErrno = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);
// pg 8.x and pg-pool raise these transport failures as plain Error without a code.
// Exact texts are compared, never logged; tests pin them to the installed driver.
const driverTransportMessages = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'Query read timeout',
  'Client has encountered a connection error and is not queryable',
]);

function property(error: object, name: string): unknown {
  return Reflect.get(error, name);
}

export function failureCause(error: unknown): FailureCause {
  if (typeof error !== 'object' || error === null) return { errorName: typeof error };
  const name = property(error, 'name');
  const code = property(error, 'code');
  const errorName =
    typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error';
  // pg DatabaseError carries severity; Node system errors carry a syscall/errno instead.
  if (typeof code === 'string' && 'severity' in error && /^[0-9A-Z]{5}$/.test(code))
    return { errorName, sqlstate: code };
  if (typeof code === 'string' && /^E[A-Z0-9_]{1,31}$/.test(code))
    return { errorName, errno: code };
  return { errorName };
}

export function classifyFailure(error: unknown): FailureKind {
  const cause = failureCause(error);
  if (cause.errorName === 'AbortError' || cause.errorName === 'TimeoutError') return 'cancelled';
  if (cause.errno === 'ENOSPC' || cause.errno === 'EDQUOT') return 'storage_full';
  if (cause.sqlstate === '53100') return 'storage_full'; // disk_full on the database server
  if (cause.sqlstate && (cause.sqlstate.startsWith('08') || unavailableStates.has(cause.sqlstate)))
    return 'dependency_unavailable';
  if (cause.errno && unavailableErrno.has(cause.errno)) return 'dependency_unavailable';
  if (
    error instanceof Error &&
    Object.getPrototypeOf(error) === Error.prototype &&
    driverTransportMessages.has(error.message)
  )
    return 'dependency_unavailable';
  return 'unexpected';
}

/** Strips URLs, credential-looking pairs and long tokens; bounded for one log line. */
export function redactDiagnostic(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]*/gi, '<redacted-url>')
    .replace(/\b(password|passwd|secret|token|key|apikey)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .replace(/\barkvory_[A-Za-z0-9_-]+/g, '<redacted>')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '<redacted>')
    .slice(0, 240);
}

const startupStates: Readonly<Record<string, string>> = {
  '28000': 'database authentication failed',
  '28P01': 'database authentication failed',
  '3D000': 'database does not exist',
  '42P01': 'database schema is missing; run migrations',
  '42501': 'database role lacks a required privilege',
};

/**
 * Startup reason safe for operator logs. Only messages written by Arkvory validation
 * (ArkvoryError or a plain Error) are kept, and still redacted; library and system errors
 * are reduced to their constant identifiers because their texts may echo inputs.
 */
export function startupReason(error: unknown): string {
  if (error instanceof ArkvoryError) return `${error.code}: ${redactDiagnostic(error.message)}`;
  const cause = failureCause(error);
  const known = cause.sqlstate ? startupStates[cause.sqlstate] : undefined;
  if (known) return known;
  const kind = classifyFailure(error);
  if (kind === 'dependency_unavailable' || kind === 'storage_full') return kind.replace('_', ' ');
  if (kind === 'cancelled') return 'interrupted';
  if (cause.sqlstate) return 'database rejected the connection or query';
  if (cause.errno) return 'system call failed';
  if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)
    return redactDiagnostic(error.message);
  return 'unexpected failure';
}

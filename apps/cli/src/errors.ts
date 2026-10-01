import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';
import type { ClientErrorCode } from '@proanima/arkvory-sdk';
import { explain } from './explanations.js';

export class CliError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode = 2,
  ) {
    super(code);
  }
}

export class PublicationError extends Error {
  constructor(
    readonly artifactId: string,
    readonly reason: unknown,
  ) {
    super('publication_registration_failed');
  }
}

/** Machine description of a failure; `code` keeps its pre-ADR 0051 meaning (`http_error`). */
export interface Failure {
  readonly code: string;
  readonly exitCode: number;
  readonly status?: number;
  readonly stage?: string;
  readonly artifactId?: string;
  /** Server error code and reason (ADR 0051), or the job code of a failed completion. */
  readonly serverCode?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly requestId?: string;
  readonly details?: readonly { readonly field: string; readonly problem: string }[];
  readonly retryAfterSeconds?: number;
}

// Exit codes by server code first, then by status for answers without the envelope (docs/CLI.md).
const exitByCode: Readonly<Record<string, number>> = {
  unauthorized: 3,
  forbidden: 3,
  conflict: 6,
  integrity_mismatch: 5,
  capacity_exceeded: 8,
};
const exitByStatus: Readonly<Record<number, number>> = { 401: 3, 403: 3, 409: 6, 422: 5, 507: 8 };
const clientExit: Readonly<Record<ClientErrorCode, number>> = {
  invalid_argument: 2,
  insecure_url: 2,
  invalid_response: 7,
  response_too_large: 7,
  size_mismatch: 6,
  file_changed: 6,
  upload_cancelled: 6,
  completion_failed: 4,
};

// C0/C1 controls (terminal escapes), zero-width, line separators and bidirectional overrides.
const unsafe = (code: number) =>
  code < 32 ||
  (code >= 127 && code < 160) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

/** One line, no control or bidirectional characters, bounded: safe to print on a terminal. */
export function sanitize(value: string, limit = 200): string {
  const line = Array.from(value, (char) => (unsafe(char.charCodeAt(0)) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function httpFailure(error: ArkvoryHttpError): Failure {
  const enveloped = error.code !== 'http_error';
  const seconds = error.retryAfterSeconds;
  return {
    code: 'http_error',
    status: error.status,
    exitCode: exitByCode[error.code] ?? exitByStatus[error.status] ?? 4,
    ...(enveloped ? { serverCode: error.code } : {}),
    ...(error.reason === undefined ? {} : { reason: error.reason }),
    ...(error.serverMessage ? { message: sanitize(error.serverMessage) } : {}),
    ...(error.requestId ? { requestId: sanitize(error.requestId, 128) } : {}),
    ...(error.details.length ? { details: error.details } : {}),
    ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
  };
}

/** Never reflect local paths, argv or credentials; server text only through sanitize. */
export function failure(error: unknown, cancelled: boolean): Failure {
  if (error instanceof PublicationError)
    return { ...failure(error.reason, cancelled), stage: 'register', artifactId: error.artifactId };
  if (cancelled) return { code: 'interrupted', exitCode: 130 };
  if (error instanceof CliError) return { code: error.code, exitCode: error.exitCode };
  if (error instanceof ArkvoryIntegrityError) return { code: 'integrity_failed', exitCode: 5 };
  if (error instanceof ArkvoryNetworkError) return { code: 'network_failed', exitCode: 4 };
  if (error instanceof Error && error.name === 'TimeoutError')
    return { code: 'request_timeout', exitCode: 4 };
  if (error instanceof ArkvoryHttpError) return httpFailure(error);
  if (error instanceof ArkvoryClientError)
    return {
      code: error.code,
      exitCode: clientExit[error.code],
      ...(error.serverCode ? { serverCode: sanitize(error.serverCode, 64) } : {}),
    };
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') return { code: 'file_not_found', exitCode: 7 };
    if (error.code === 'EACCES' || error.code === 'EPERM')
      return { code: 'permission_denied', exitCode: 7 };
    if (error.code === 'ENOSPC') return { code: 'disk_full', exitCode: 7 };
  }
  return { code: 'local_or_protocol_error', exitCode: 7 };
}

/** The human line on stderr: what failed, the server's words, what to do, how to refer to it. */
export function failureText(result: Failure, language: 'en' | 'ru'): string {
  const ru = language === 'ru';
  const server =
    result.serverCode === undefined
      ? ''
      : ` ${result.serverCode}${result.reason === undefined ? '' : `/${result.reason}`}`;
  const status = result.status === undefined ? '' : ` HTTP ${String(result.status)}`;
  const said = result.message ? `: ${result.message}` : '';
  const parts = [`Arkvory: ${result.code}${status}${server}${said}.`, explain(result, language)];
  if (result.retryAfterSeconds !== undefined)
    parts.push(
      ru
        ? `Повторите через ${String(result.retryAfterSeconds)} с.`
        : `Retry after ${String(result.retryAfterSeconds)} s.`,
    );
  if (result.requestId) parts.push(`${ru ? 'ID запроса' : 'Request ID'}: ${result.requestId}`);
  if (result.stage === 'register')
    parts.push(
      ru
        ? 'Файл загружен; регистрация UPack не подтверждена. Повторите packages publish с теми же параметрами.'
        : 'File uploaded; UPack registration is unconfirmed. Repeat packages publish with the same options.',
    );
  return parts.join(' ');
}

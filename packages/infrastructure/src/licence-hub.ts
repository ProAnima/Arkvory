import { readFile } from 'node:fs/promises';
import type {
  LicenceHub,
  LicenceHubAnswer,
  LicenceHubOutcome,
  LicenceSignal,
  LicenceTransportFailure,
} from '@proanima/arkvory-application';

/**
 * The hub's licence calls (ADR 0078, R2; pas-Hub README, "Licences") from the core's own hub
 * client: the address and project of `config/hub.json` (ADR 0060), https only (plain http on
 * loopback for a hub under test), the default certificate verification of Node, no redirects,
 * bounded time and answer size, no credentials beyond what each body carries. Nothing here logs
 * a body: the activation request carries the licence key, refresh the activation secret.
 */
export interface LicenceHubSettings {
  /** Null: the hub is off (`--hub-off`); only offline activation is left. */
  readonly url: string | null;
  readonly project: string;
}

export const DEFAULT_LICENCE_HUB: LicenceHubSettings = {
  url: 'https://hub.proanima.net',
  project: 'arkvory',
};
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TIMEOUT_MS = 30_000;
const ANSWER_LIMIT = 64 * 1024;
const LIST_LIMIT = 1024 * 1024;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const ACTIVATION = /^act_[0-9A-HJKMNP-TV-Z]{26}$/;
/** Errors that come before a request leaves: nothing reached the hub. */
const NOT_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
]);

/** The hub's origin under the rule of the deployment's hub settings. */
export function licenceHubUrl(value: string): string {
  const url = new URL(value);
  const plain = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (
    (url.protocol !== 'https:' && !plain) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('The hub address must be an https origin');
  return url.href.replace(/\/+$/, '');
}

/** `config/hub.json` of the installation; defaults when the file does not exist. */
export async function readLicenceHubSettings(
  path: string | undefined,
): Promise<LicenceHubSettings> {
  if (path === undefined || path === '') return DEFAULT_LICENCE_HUB;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return DEFAULT_LICENCE_HUB;
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid hub settings');
  const settings: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const { url, project } = settings;
  if (settings['format'] !== 1) throw new Error('Invalid hub settings');
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project))
    throw new Error('Invalid hub project');
  if (url !== null && typeof url !== 'string') throw new Error('Invalid hub address');
  return { url: url === null ? null : licenceHubUrl(url), project };
}

type Exchange =
  | { readonly status: number; readonly text: string; readonly retryAfterMs: number | null }
  | Extract<LicenceHubAnswer, { kind: 'failed' }>;

const failure = (
  kind: LicenceTransportFailure,
  sent: boolean,
  retryAfterMs: number | null = null,
) => ({ kind: 'failed', failure: kind, sent, retryAfterMs }) as const;

function classify(error: unknown): Extract<LicenceHubAnswer, { kind: 'failed' }> {
  if (error instanceof Error && error.name === 'TimeoutError') return failure('timeout', true);
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : '';
  if (NOT_SENT.has(code)) return failure('unreachable', false);
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME/.test(code))
    return failure('tls_failed', false);
  return failure('unreachable', true);
}

async function bounded(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) return null;
    size += chunk.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null || !/^\d{1,7}$/.test(header)) return null;
  return Number(header) * 1000;
}

function objectOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value));
  } catch {
    return null;
  }
}

/** A refusal's machine code; anything else is the hub's generic refusal. */
function refusal(status: number, text: string, retryAfterMs: number | null): LicenceHubAnswer {
  const code = objectOf(text)?.['code'];
  return {
    kind: 'refused',
    status,
    code: typeof code === 'string' && CODE.test(code) ? code : 'hub_refused',
    retryAfterMs,
  };
}

/** `200 {token, activationSecret, activationId}` or `200 {revocation}`, exactly. */
function issued(text: string): LicenceHubAnswer {
  const body = objectOf(text);
  const keys = body === null ? '' : Object.keys(body).sort().join(',');
  const { token, activationSecret, activationId, revocation } = body ?? {};
  if (
    keys === 'activationId,activationSecret,token' &&
    typeof token === 'string' &&
    typeof activationSecret === 'string' &&
    SECRET.test(activationSecret) &&
    typeof activationId === 'string' &&
    ACTIVATION.test(activationId)
  )
    return { kind: 'issued', token, activationSecret, activationId };
  if (keys === 'revocation' && typeof revocation === 'string')
    return { kind: 'revoked', revocation };
  return failure('answer_invalid', true);
}

/**
 * The caller's signal and the timeout as one AbortSignal. The use cases pass Node's AbortSignal;
 * another implementation of the port's signal is followed through its abort event.
 */
function signalOf(signal: LicenceSignal | undefined) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (signal === undefined) return timeout;
  if (signal instanceof AbortSignal) return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else
    signal.addEventListener('abort', () => {
      controller.abort();
    });
  return AbortSignal.any([controller.signal, timeout]);
}

/** The hub's licence calls over HTTPS; `fetch` is replaceable only for tests of failures. */
export function httpLicenceHub(
  settings: LicenceHubSettings,
  request: typeof fetch = fetch,
): LicenceHub {
  const address = (path: string) =>
    `${settings.url ?? ''}/v1/${encodeURIComponent(settings.project)}/licence/${path}`;
  async function call(path: string, init: RequestInit, limit: number, signal?: LicenceSignal) {
    if (settings.url === null) return failure('hub_off', false);
    let response: Response;
    try {
      response = await request(address(path), {
        ...init,
        headers: {
          accept: 'application/json',
          'user-agent': 'ProAnima-Arkvory',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        redirect: 'error',
        signal: signalOf(signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return classify(error);
    }
    const text = await bounded(response, limit).catch(() => null);
    if (text === null) return failure('answer_invalid', true);
    return { status: response.status, text, retryAfterMs: retryAfter(response) } as Exchange;
  }
  async function exchange(path: string, body: unknown, signal?: LicenceSignal) {
    const answer = await call(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      ANSWER_LIMIT,
      signal,
    );
    if ('kind' in answer) return answer;
    if (answer.status === 200) return issued(answer.text);
    // The hub rolls a failed transaction back: the secret it was sent is still the current one.
    if (answer.status >= 500) return failure('hub_error', true, answer.retryAfterMs);
    return refusal(answer.status, answer.text, answer.retryAfterMs);
  }
  return {
    activate: (body, signal) => exchange('activate', body, signal),
    refresh: (body, signal) => exchange('refresh', body, signal),
    async deactivate(body, signal): Promise<LicenceHubOutcome> {
      const init = { method: 'POST', body: JSON.stringify(body) };
      const answer = await call('deactivate', init, ANSWER_LIMIT, signal);
      if ('kind' in answer) return answer;
      if (answer.status === 204 || answer.status === 200) return { kind: 'done' };
      if (answer.status >= 500) return failure('hub_error', true, answer.retryAfterMs);
      const refused = refusal(answer.status, answer.text, answer.retryAfterMs);
      return refused.kind === 'refused' ? refused : failure('answer_invalid', true);
    },
    async revocations(after, signal) {
      const answer = await call(
        `revocations?after=${String(after)}`,
        { method: 'GET' },
        LIST_LIMIT,
        signal,
      );
      if ('kind' in answer) {
        if (answer.failure === 'hub_off') return null;
        throw new Error(`Licence revocation list unavailable: ${answer.failure}`);
      }
      if (answer.status === 204) return null;
      if (answer.status !== 200)
        throw new Error(`Licence revocation list refused: ${String(answer.status)}`);
      return answer.text;
    },
  };
}

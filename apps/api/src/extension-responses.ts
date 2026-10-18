import type { FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { MODULE_JSON_RESPONSE_LIMIT, MODULE_ROUTE_ERRORS } from '@proanima/arkvory-extension-api';
import type { ModuleRouteError } from '@proanima/arkvory-extension-api';
import type {
  AdmissionQueue,
  BandwidthGovernor,
  DiagnosticLogger,
} from '@proanima/arkvory-infrastructure';
import type { createContentSender } from './download-routes.js';
import { downloadStream } from './download-stream.js';
import type { CheckedRoute } from './extension-route-check.js';
import { matchesEtag } from './range.js';

/** What sending a module's answer needs from the process. */
export interface ResponseServices {
  readonly sendContent: ReturnType<typeof createContentSender>;
  readonly downloadGate: Pick<AdmissionQueue, 'acquire'>;
  readonly downloadBandwidth: Pick<BandwidthGovernor, 'stream'>;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
}

type Answer =
  | { readonly kind: 'json'; readonly status: number; readonly text: string }
  | {
      readonly kind: 'content';
      readonly repository: string;
      readonly artifact: string;
      readonly immutable: boolean;
    }
  | {
      readonly kind: 'stream';
      readonly contentType: string;
      readonly length: number | null;
      readonly etag: string | null;
      readonly body: AsyncIterable<unknown>;
    }
  | { readonly kind: 'error'; readonly code: ModuleRouteError };

/** An answer outside the contract: a defect of the module, never sent as it is. */
export class ModuleResponseError extends Error {
  override readonly name = 'ModuleResponseError';
}

const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}(?:; ?charset=[a-z0-9_-]{1,32})?$/;
/**
 * Types a browser may render as a document or run (ADR 0082, 7.6): refused for every module. The
 * script part covers every JavaScript MIME type of the WHATWG MIME Sniffing standard.
 */
const ACTIVE_TYPE = /html|xml|svg|javascript|ecmascript|jscript|livescript/;
const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,128}"$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A year: the longest a private cache keeps a published blob (ADR 0083, N7). */
export const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

const field = (value: unknown, key: PropertyKey): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

function isIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  );
}

/** JSON text of a plain JSON value; anything else (cycles, functions, NaN) is refused. */
function jsonText(value: unknown, limit: number): string {
  const seen = new Set<object>();
  const check = (item: unknown, depth: number): void => {
    if (depth > 64) throw new ModuleResponseError('JSON too deep');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item)) throw new ModuleResponseError('Not JSON');
    seen.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) check(child, depth + 1);
    seen.delete(item);
  };
  check(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > limit) throw new ModuleResponseError('JSON too large');
  return text;
}

function streamAnswer(value: unknown, route: CheckedRoute): Answer {
  const contentType = field(value, 'contentType');
  const length = field(value, 'length');
  const etag = field(value, 'etag');
  const body = field(value, 'body');
  if (
    typeof contentType !== 'string' ||
    !MEDIA_TYPE.test(contentType) ||
    ACTIVE_TYPE.test(contentType) ||
    (length !== null &&
      (typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > route.responseLimit)) ||
    (etag !== null && (typeof etag !== 'string' || !STRONG_ETAG.test(etag))) ||
    !isIterable(body)
  )
    throw new ModuleResponseError('Invalid stream answer');
  return { kind: 'stream', contentType, length, etag, body };
}

function readAnswer(value: unknown, route: CheckedRoute): Answer {
  const kind = field(value, 'kind');
  if (kind === 'json') {
    const status = field(value, 'status');
    if (status !== 200 && status !== 201 && status !== 202)
      throw new ModuleResponseError('Invalid status');
    const limit = Math.min(route.responseLimit, MODULE_JSON_RESPONSE_LIMIT);
    return { kind, status, text: jsonText(field(value, 'body'), limit) };
  }
  if (kind === 'content') {
    const repository = field(value, 'repository');
    const artifact = field(value, 'artifact');
    const cache = field(value, 'cache');
    if (
      typeof repository !== 'string' ||
      !IDENTIFIER.test(repository) ||
      typeof artifact !== 'string' ||
      !IDENTIFIER.test(artifact) ||
      (cache !== undefined && cache !== 'no-store' && cache !== 'immutable')
    )
      throw new ModuleResponseError('Invalid content answer');
    return { kind, repository, artifact, immutable: cache === 'immutable' };
  }
  if (kind === 'stream') return streamAnswer(value, route);
  const code = MODULE_ROUTE_ERRORS.find(
    (known) => kind === 'error' && known === field(value, 'code'),
  );
  if (code === undefined) throw new ModuleResponseError('Invalid answer');
  return { kind: 'error', code };
}

/**
 * Reads a handler's answer as untrusted input (`ModuleResponse` of extension-api). The JSON of a
 * `json` answer is serialized here, within the route's limit. Whatever fails while the answer is
 * read (a getter or a proxy of the module that throws) is an answer outside the contract too.
 */
export function answerOf(value: unknown, route: CheckedRoute): Answer {
  try {
    return readAnswer(value, route);
  } catch (error) {
    if (error instanceof ModuleResponseError) throw error;
    throw new ModuleResponseError('Unreadable answer', { cause: error });
  }
}

/**
 * Closes the body of an answer the core does not send; a failure to close is the module's. It
 * never throws: it also runs on late answers, where a throw would be an unhandled rejection
 * and stop the process (crash-only policy).
 */
export function closeBody(value: unknown): void {
  try {
    const body = field(value, 'body');
    if (!isIterable(body)) return;
    const iterator = body[Symbol.asyncIterator]();
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  } catch {
    // An answer that cannot even give its body holds nothing the core could release.
  }
}

/**
 * The bytes of a `stream` answer: only `Uint8Array` chunks, never more than the limit and, when
 * the module named a length, exactly that many. After the headers a violation can only end the
 * response, so the error destroys it and the log records `download.read_failed`.
 */
async function* counted(body: AsyncIterable<unknown>, length: number | null, limit: number) {
  let total = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) throw new ModuleResponseError('Invalid stream chunk');
    total += chunk.byteLength;
    if (total > (length ?? limit)) throw new ModuleResponseError('Stream exceeds its length');
    yield chunk;
  }
  if (length !== null && total !== length) throw new ModuleResponseError('Stream is short');
}

async function sendStream(
  answer: Extract<Answer, { kind: 'stream' }>,
  route: CheckedRoute,
  call: ResponseCall,
): Promise<FastifyReply> {
  const { request, reply, services, principal, signal } = call;
  reply.header('Content-Type', answer.contentType).header('Accept-Ranges', 'none');
  if (answer.etag !== null) reply.header('ETag', answer.etag);
  if (answer.etag !== null && matchesEtag(request.headers['if-none-match'], answer.etag)) {
    closeBody(answer);
    return reply.code(304).send();
  }
  if (answer.length !== null) reply.header('Content-Length', String(answer.length));
  if (request.method === 'HEAD') {
    closeBody(answer);
    return reply.send();
  }
  let release: () => void;
  try {
    release = await services.downloadGate.acquire(principal.id, signal);
  } catch (error) {
    closeBody(answer);
    throw error;
  }
  const stream = downloadStream(
    services.downloadBandwidth.stream(
      counted(answer.body, answer.length, route.responseLimit),
      principal.id,
      signal,
    ),
    request,
    signal,
    services.diagnostics,
  );
  stream.once('close', release);
  return reply.send(stream);
}

/** One request whose module answered. */
export interface ResponseCall {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly services: ResponseServices;
  readonly principal: Principal;
  readonly signal: AbortSignal;
}

/** Replies of `content` answers with `cache: 'immutable'`, until they are sent. */
const immutable = new WeakSet<FastifyReply>();
/** The published bytes, whole or in part, or the confirmation that a cached copy is current. */
const CACHEABLE = [200, 206, 304];

/**
 * `onSend` of module routes: a year of private caching only for the published bytes of a
 * `content` answer with `cache: 'immutable'`. A refusal, a queued download (503), an
 * unsatisfiable range (416) or any other answer on the same URL is `no-store`: a cache must
 * never keep it in place of the bytes. The content sender answers some of them without a throw,
 * so the status decides here, right before the headers leave.
 */
export function immutableCaching(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (immutable.has(reply))
    reply.header(
      'Cache-Control',
      CACHEABLE.includes(reply.statusCode) ? IMMUTABLE_CACHE : 'private, no-store',
    );
  return Promise.resolve(payload);
}

/**
 * Sends a checked answer: JSON as it is, content through the core's content sender (pin,
 * `content.read`, ETag, 304, Range, `If-Range`, the download queue and bandwidth), a stream
 * admitted per request and paced, a refusal as the error envelope.
 */
export async function sendAnswer(
  answer: Answer,
  route: CheckedRoute,
  call: ResponseCall,
): Promise<FastifyReply> {
  const { request, reply, services } = call;
  switch (answer.kind) {
    case 'json':
      return reply
        .code(answer.status)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send(answer.text);
    case 'error':
      throw new ArkvoryError(answer.code, 'The module refused the request');
    case 'stream':
      return sendStream(answer, route, call);
    case 'content':
      if (answer.immutable) immutable.add(reply);
      return services.sendContent(request, reply, answer.repository, answer.artifact);
  }
}

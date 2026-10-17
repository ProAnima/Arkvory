import type { CallToolResult } from '@modelcontextprotocol/server';
import { failure } from '../errors.js';
import type { ToolContext } from './context.js';

/** Most items one list result carries; more come with the `next` cursor. */
export const MAX_ITEMS = 100;
export const DEFAULT_OUTPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const MIN_OUTPUT_BYTES = 4096;
// The text block repeats the JSON for clients that read only text, so each copy gets half.
const reserve = 1024;

// C0/C1 controls (terminal escapes), zero-width, line separators and bidirectional overrides.
const unsafe = (code: number) =>
  code < 32 ||
  (code >= 127 && code < 160) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
function plain(text: string): string {
  let out = '';
  for (const char of text) out += unsafe(char.codePointAt(0) ?? 0) ? ' ' : char;
  return out;
}
// Download links (ADR 0062) are bearer credentials whatever field they appear in.
const linkToken = /dtl_[A-Za-z0-9_-]{8,}/g;
const withheld = '[withheld]';

export function outputBytes(value: string | undefined): number {
  if (value !== undefined && !/^[1-9][0-9]{0,7}$/.test(value))
    throw new RangeError('max-output-bytes');
  const parsed = Number(value ?? DEFAULT_OUTPUT_BYTES);
  if (parsed < MIN_OUTPUT_BYTES || parsed > MAX_OUTPUT_BYTES)
    throw new RangeError('max-output-bytes');
  return parsed;
}

/**
 * Data of other users (names, labels, metadata, paths) as plain data: controls removed,
 * secrets withheld, long strings shortened. Keys are cleaned too: metadata keys are user data.
 */
export function clean(value: unknown, secrets: readonly string[], maxString = 4096): unknown {
  if (typeof value === 'string') {
    let text = plain(value).replace(linkToken, withheld);
    for (const secret of secrets) if (secret) text = text.split(secret).join(withheld);
    return text.length > maxString ? `${text.slice(0, maxString - 1)}…` : text;
  }
  if (Array.isArray(value)) return value.map((entry: unknown) => clean(entry, secrets, maxString));
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        clean(key, secrets, 256),
        clean(entry, secrets, maxString),
      ]),
    );
  return value;
}

function budget(ctx: ToolContext): number {
  return Math.floor((ctx.maxOutputBytes - reserve) / 2);
}
function size(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** The structured result and, for clients that read only text, a summary line and its JSON. */
function result(structured: Record<string, unknown>, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
  };
}

/** One object result; shortened strings first, then refused as `output_too_large`. */
export function objectResult(
  ctx: ToolContext,
  value: Record<string, unknown>,
  summary: string,
): CallToolResult {
  const full = record(clean({ ...value, truncated: false }, ctx.secrets));
  if (size(full) <= budget(ctx)) return result(full, summary);
  const short = record(clean({ ...value, truncated: true }, ctx.secrets, 256));
  if (size(short) <= budget(ctx)) return result(short, `${summary} (shortened)`);
  return codedError('output_too_large');
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
  /** Fields of the page besides items and cursor, such as the head of a change feed. */
  readonly extra?: Record<string, unknown>;
}
export interface ListRequest<T> {
  readonly limit: number;
  /** The server page; called again with a smaller limit when a page does not fit. */
  readonly fetch: (limit: number) => Promise<Page<T>>;
  /** Cursor that continues after an item, when the API's cursor is the item's own key. */
  readonly cursorOf?: (item: T) => string;
  readonly noun: string;
}

/**
 * A list result of at most MAX_ITEMS within the byte bound. A page that does not fit is cut to
 * the longest fitting prefix; the cursor then continues right after the last returned item,
 * either derived from it or by asking the server for exactly that many items. Nothing between
 * two pages is skipped; `truncated` says fewer items came than were asked for.
 */
export async function listResult<T>(ctx: ToolContext, request: ListRequest<T>) {
  const page = await request.fetch(request.limit);
  const items = page.items.slice(0, MAX_ITEMS).map((item) => clean(item, ctx.secrets));
  const body = (
    list: readonly unknown[],
    next: string | null,
    truncated: boolean,
    extra = page.extra,
  ) => record(clean({ ...extra, items: list, next, truncated }, ctx.secrets));
  const summary = (count: number, next: string | null) =>
    `${String(count)} ${request.noun}${next === null ? '' : '; more with after = next'}`;
  const full = body(items, page.next, items.length < page.items.length);
  if (size(full) <= budget(ctx)) return result(full, summary(items.length, page.next));
  let fits = 0;
  for (let low = 0, high = items.length; low <= high;) {
    const middle = Math.floor((low + high) / 2);
    if (size(body(items.slice(0, middle), null, true)) <= budget(ctx) - 256) {
      fits = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const last = page.items[fits - 1];
  if (fits > 0 && request.cursorOf && last !== undefined) {
    const next = request.cursorOf(last);
    return result(body(items.slice(0, fits), next, true), summary(fits, next));
  }
  if (fits > 0) {
    const smaller = await request.fetch(fits);
    const again = body(smaller.items, smaller.next, true, smaller.extra);
    if (size(again) <= budget(ctx))
      return result(again, summary(smaller.items.length, smaller.next));
  }
  return result(body(items.slice(0, fits), null, true), `${summary(fits, null)} (cut short)`);
}

/** A tool failure: the machine code of ADR 0051 (or a local code) and the request ID. */
export function errorResult(error: unknown, signal: AbortSignal): CallToolResult {
  const f = failure(error, signal.aborted);
  // A local SHA-256 or size mismatch carries the contract's code for the same condition.
  const code = f.serverCode ?? (f.code === 'integrity_failed' ? 'integrity_mismatch' : f.code);
  const detail = {
    code,
    ...(f.reason === undefined ? {} : { reason: f.reason }),
    ...(f.status === undefined ? {} : { status: f.status }),
    ...(f.requestId === undefined ? {} : { requestId: f.requestId }),
    ...(f.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: f.retryAfterSeconds }),
    ...(f.details === undefined ? {} : { details: f.details }),
  };
  const structured = record(clean({ error: detail }, []));
  const id = f.requestId === undefined ? '' : ` (request ${f.requestId})`;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Arkvory error ${code}${f.reason === undefined ? '' : `/${f.reason}`}${id}`,
      },
    ],
    structuredContent: structured,
  };
}
export function codedError(code: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `Arkvory error ${code}` }],
    structuredContent: { error: { code } },
  };
}

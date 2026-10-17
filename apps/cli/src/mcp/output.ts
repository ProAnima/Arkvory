import type { CallToolResult } from '@modelcontextprotocol/server';
import { failure } from '../errors.js';
import type { ToolContext } from './context.js';

/** Most items one list result carries; more come with the `next` cursor. */
export const MAX_ITEMS = 100;
export const DEFAULT_OUTPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const MIN_OUTPUT_BYTES = 4096;
// Room for the JSON-RPC envelope around a result (`jsonrpc`, `id`, `result`).
const envelope = 256;
const LONG_STRING = 4096;
const SHORT_STRING = 256;

// Characters that change how text is shown or hide text from a reader: C0/C1 controls (terminal
// escapes), soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width characters
// and joiners, line separators, bidirectional overrides and isolates, invisible operators,
// byte order mark, interlinear annotation, lone surrogates and the tag block (U+E0000–E007F),
// which can carry ASCII text no one sees.
const unsafe = (code: number) =>
  code < 32 ||
  (code >= 127 && code < 160) ||
  code === 0xad ||
  code === 0x61c ||
  code === 0x180e ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x206f) ||
  (code >= 0xd800 && code <= 0xdfff) ||
  code === 0xfeff ||
  (code >= 0xfff9 && code <= 0xfffb) ||
  (code >= 0xe0000 && code <= 0xe007f);
function plain(text: string): string {
  let out = '';
  // Iterating by code point yields a lone surrogate on its own, so it is replaced too.
  for (const char of text) out += unsafe(char.codePointAt(0) ?? 0) ? ' ' : char;
  return out;
}
/** At most `limit` UTF-16 units with the ellipsis, never splitting a surrogate pair. */
function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}
// Download links (ADR 0062) are bearer credentials whatever field they appear in.
const linkToken = /dtl_[A-Za-z0-9_-]{8,}/g;
const withheld = '[withheld]';
// Request IDs are server-generated tokens; anything else is not repeated in the text block.
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

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
export function clean(
  value: unknown,
  secrets: readonly string[],
  maxString = LONG_STRING,
): unknown {
  if (typeof value === 'string') {
    let text = plain(value).replace(linkToken, withheld);
    for (const secret of secrets) if (secret) text = text.split(secret).join(withheld);
    return shorten(text, maxString);
  }
  if (Array.isArray(value)) return value.map((entry: unknown) => clean(entry, secrets, maxString));
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        clean(key, secrets, SHORT_STRING),
        clean(entry, secrets, maxString),
      ]),
    );
  return value;
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
/**
 * Whether the result, as it is serialized on the wire, stays within the bound. The text block
 * repeats the JSON escaped once more, so its share is measured, not estimated.
 */
function fits(ctx: ToolContext, value: CallToolResult): boolean {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= ctx.maxOutputBytes - envelope;
}

/** One object result; shortened strings first, then refused as `output_too_large`. */
export function objectResult(
  ctx: ToolContext,
  value: Record<string, unknown>,
  summary: string,
): CallToolResult {
  const full = result(record(clean({ ...value, truncated: false }, ctx.secrets)), summary);
  if (fits(ctx, full)) return full;
  const short = result(
    record(clean({ ...value, truncated: true }, ctx.secrets, SHORT_STRING)),
    `${summary} (shortened)`,
  );
  if (fits(ctx, short)) return short;
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

/** Largest `count` in 0..high for which `ok(count)` holds, assuming it holds up to some point. */
function longest(high: number, ok: (count: number) => boolean): number {
  let found = 0;
  for (let low = 1; low <= high;) {
    const middle = Math.floor((low + high) / 2);
    if (ok(middle)) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/**
 * A list result of at most MAX_ITEMS within the byte bound. A page that does not fit is cut to
 * the longest fitting prefix; the cursor then continues right after the last returned item,
 * either derived from it or by asking the server for exactly that many items. Only when not even
 * one item fits are long strings shortened. Nothing between two pages is skipped: a result that
 * cannot keep its cursor is refused as `output_too_large` rather than ending the list early.
 * `truncated` says fewer items or shorter strings came than were asked for.
 */
export async function listResult<T>(
  ctx: ToolContext,
  request: ListRequest<T>,
): Promise<CallToolResult> {
  const page = await request.fetch(request.limit);
  const all = page.items.slice(0, MAX_ITEMS);
  const summary = (count: number, next: string | null) =>
    `${String(count)} ${request.noun}${next === null ? '' : '; more with after = next'}`;
  const { cursorOf } = request;
  const body = (
    source: Page<T>,
    list: readonly unknown[],
    truncated: boolean,
    next = source.next,
  ) =>
    result(
      record(clean({ ...source.extra, items: list, next, truncated }, ctx.secrets)),
      summary(list.length, next),
    );
  for (const maxString of [LONG_STRING, SHORT_STRING]) {
    const shortened = maxString === SHORT_STRING;
    const items = all.map((item) => clean(item, ctx.secrets, maxString));
    const full = body(page, items, shortened || all.length < page.items.length);
    if (fits(ctx, full)) return full;
    const after = (count: number) => {
      const last = all[count - 1];
      return cursorOf && last !== undefined ? cursorOf(last) : page.next;
    };
    const count = longest(items.length - 1, (n) =>
      fits(ctx, body(page, items.slice(0, n), true, after(n))),
    );
    if (count === 0) continue;
    if (cursorOf) return body(page, items.slice(0, count), true, after(count));
    const smaller = await request.fetch(count);
    const again = body(
      smaller,
      smaller.items.slice(0, count).map((item) => clean(item, ctx.secrets, maxString)),
      true,
    );
    if (smaller.items.length <= count && fits(ctx, again)) return again;
    break;
  }
  return codedError('output_too_large');
}

/** A tool failure: the machine code of ADR 0051 (or a local code) and the request ID. */
export function errorResult(error: unknown, signal: AbortSignal): CallToolResult {
  const f = failure(error, signal.aborted);
  // A local SHA-256 or size mismatch carries the contract's code for the same condition.
  const code = f.serverCode ?? (f.code === 'integrity_failed' ? 'integrity_mismatch' : f.code);
  const requestId =
    f.requestId !== undefined && requestIdPattern.test(f.requestId) ? f.requestId : undefined;
  const detail = {
    code,
    ...(f.reason === undefined ? {} : { reason: f.reason }),
    ...(f.status === undefined ? {} : { status: f.status }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(f.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: f.retryAfterSeconds }),
    ...(f.details === undefined ? {} : { details: f.details }),
  };
  const structured = record(clean({ error: detail }, []));
  const id = requestId === undefined ? '' : ` (request ${requestId})`;
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

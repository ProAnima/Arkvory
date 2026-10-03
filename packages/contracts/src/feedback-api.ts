import { items, record, text } from './wire-values.js';

/*
 * Feedback to ProAnimaStudio (ADR 0060). The console posts JSON; the server checks it, adds its
 * own log and system summary when an administrator asks for them, and forwards everything to the
 * ProAnimaStudio hub. The limits are the hub's: a request the hub would refuse is refused here.
 */
export const feedbackLimits = {
  messageChars: 20000,
  emailBytes: 254,
  screenshots: 6,
  screenshotBytes: 8 * 1024 * 1024,
  logBytes: 2 * 1024 * 1024,
  totalBytes: 15 * 1024 * 1024,
} as const;
export const feedbackImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type FeedbackImageType = (typeof feedbackImageTypes)[number];
export interface FeedbackScreenshot {
  readonly name: string;
  readonly type: FeedbackImageType;
  /** The image, base64. */
  readonly data: string;
}
export interface FeedbackRequest {
  readonly message: string;
  /** Where the studio may answer; nothing else is done with it. */
  readonly email: string | null;
  readonly lang: 'ru' | 'en';
  /** Viewport, e.g. `1440x900`. */
  readonly screen: string | null;
  readonly screenshots: readonly FeedbackScreenshot[];
  /** The console's own log of this page (errors, warnings, failed requests). */
  readonly clientLog: string | null;
  /** Attach the server log and system summary; administrators only. */
  readonly serverLog: boolean;
}
export interface FeedbackReceipt {
  /** The hub's id of the message, for a later reference. */
  readonly id: string;
}
/** What the server attaches when asked: shown to the administrator before sending. */
export interface FeedbackAttachmentsResponse {
  readonly serverLog: string;
  readonly system: string;
}

/** System-level operations: [path, method, operationId, access, retry]. */
export const feedbackOperations = [
  ['/feedback', 'post', 'sendFeedback', 'authenticated', 'never-automatic'],
  ['/feedback/attachments', 'get', 'getFeedbackAttachments', 'administrator', 'read'],
] as const;

const base64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Bytes a base64 string decodes to; the string must be canonical base64. */
export function base64Bytes(value: string): number {
  if (value.length % 4 !== 0 || !base64.test(value)) throw new Error('Invalid base64 data');
  return (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}
/** UTF-8 length without a runtime encoder; a lone surrogate counts as U+FFFD (3 bytes). */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
/** Characters as the hub counts them (Unicode scalar values): a surrogate pair is one. */
function codePoints(value: string): number {
  let count = 0;
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    if (code < 0xd800 || code > 0xdbff) count++;
  }
  return count;
}
const nullableText = (value: unknown) => (value === null ? null : text(value));

function screenshot(value: unknown): FeedbackScreenshot {
  const r = record(value);
  const name = text(r['name']);
  const type = feedbackImageTypes.find((item) => item === r['type']);
  if (!/^[^/\\\0]{1,120}$/.test(name) || !type) throw new Error('Invalid screenshot');
  const data = text(r['data']);
  const size = base64Bytes(data);
  if (size === 0 || size > feedbackLimits.screenshotBytes) throw new Error('Screenshot too large');
  return { name, type, data };
}

/** Strict reader: unknown fields, oversized parts or a total above the hub's limit are refused. */
export function readFeedbackRequest(value: unknown): FeedbackRequest {
  const r = record(value);
  const known = ['message', 'email', 'lang', 'screen', 'screenshots', 'clientLog', 'serverLog'];
  if (Object.keys(r).some((key) => !known.includes(key))) throw new Error('Unknown feedback field');
  const message = text(r['message']).trim();
  if (!message || codePoints(message) > feedbackLimits.messageChars)
    throw new Error('Invalid feedback message');
  const email = nullableText(r['email'] ?? null);
  if (
    email !== null &&
    (utf8Bytes(email) > feedbackLimits.emailBytes || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error('Invalid feedback email');
  const lang = r['lang'];
  if (lang !== 'ru' && lang !== 'en') throw new Error('Invalid feedback language');
  const screen = nullableText(r['screen'] ?? null);
  if (screen !== null && !/^\d{1,5}x\d{1,5}$/.test(screen)) throw new Error('Invalid screen');
  const shots = items(r['screenshots']);
  if (shots.length > feedbackLimits.screenshots) throw new Error('Too many screenshots');
  const screenshots = shots.map(screenshot);
  const clientLog = nullableText(r['clientLog'] ?? null);
  if (clientLog !== null && utf8Bytes(clientLog) > feedbackLimits.logBytes)
    throw new Error('Client log too large');
  if (typeof r['serverLog'] !== 'boolean') throw new Error('Invalid serverLog flag');
  const total =
    utf8Bytes(message) +
    screenshots.reduce((sum, shot) => sum + base64Bytes(shot.data), 0) +
    (clientLog === null ? 0 : utf8Bytes(clientLog));
  // The server's own attachments must still fit: they are bounded to 2 MiB each.
  if (total > feedbackLimits.totalBytes - (r['serverLog'] ? 2 * feedbackLimits.logBytes : 0))
    throw new Error('Feedback too large');
  return {
    message,
    email,
    lang,
    screen,
    screenshots,
    clientLog,
    serverLog: r['serverLog'],
  };
}
export function readFeedbackReceipt(value: unknown): FeedbackReceipt {
  return { id: text(record(value)['id']) };
}
export function readFeedbackAttachments(value: unknown): FeedbackAttachmentsResponse {
  const r = record(value);
  return { serverLog: text(r['serverLog']), system: text(r['system']) };
}

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const json = (description: string, schema: unknown) => ({
  description,
  content: { 'application/json': { schema } },
});
const nullableString = (maxLength: number) => ({ type: 'string', maxLength, nullable: true });
export const feedbackPaths = {
  '/api/v1/feedback': {
    post: {
      summary:
        'Send feedback with screenshots and logs to ProAnimaStudio through the hub; the server log needs an administrator',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: object(
              {
                message: { type: 'string', minLength: 1, maxLength: feedbackLimits.messageChars },
                email: nullableString(feedbackLimits.emailBytes),
                lang: { type: 'string', enum: ['ru', 'en'] },
                screen: nullableString(11),
                screenshots: {
                  type: 'array',
                  maxItems: feedbackLimits.screenshots,
                  items: object({
                    name: { type: 'string', minLength: 1, maxLength: 120 },
                    type: { type: 'string', enum: feedbackImageTypes },
                    data: { type: 'string', format: 'byte' },
                  }),
                },
                clientLog: nullableString(feedbackLimits.logBytes),
                serverLog: { type: 'boolean' },
              },
              ['message', 'lang', 'screenshots', 'serverLog'],
            ),
          },
        },
      },
      responses: {
        '202': json('Accepted by the hub; mail follows.', object({ id: { type: 'string' } })),
      },
    },
  },
  '/api/v1/feedback/attachments': {
    get: {
      summary: 'The server log and system summary that feedback would attach',
      responses: {
        '200': json(
          'Texts without secrets.',
          object({ serverLog: { type: 'string' }, system: { type: 'string' } }),
        ),
      },
    },
  },
} as const;

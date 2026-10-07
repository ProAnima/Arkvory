import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WebhookFailure } from '@proanima/arkvory-application';

/** A secret shorter than this is refused: a signature over a guessable key proves nothing. */
export const MIN_WEBHOOK_SECRET_BYTES = 16;

/**
 * `sha256=<hex>` of HMAC-SHA256 over `<timestamp>.<body>` (ADR 0069). The timestamp is part of
 * the signed text, so a captured delivery cannot be replayed with a fresh timestamp.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`)
    .digest('hex')}`;
}

export interface WebhookVerification {
  /** Every secret the receiver accepts: two while a rotation runs. */
  readonly secrets: readonly string[];
  /** Value of `X-Arkvory-Timestamp`. */
  readonly timestamp: string;
  /** Value of `X-Arkvory-Signature`: one or two comma-separated `sha256=<hex>`. */
  readonly signature: string;
  /** The raw body exactly as received, before any parsing. */
  readonly body: string;
  readonly nowSeconds: number;
  /** Largest accepted age or lead of the timestamp; 300 s by default. */
  readonly toleranceSeconds?: number;
}

/**
 * Reference check of a delivery for receivers and for the tests of the sender. It accepts when
 * the timestamp is within the tolerance and any given signature matches any given secret, by a
 * comparison whose time does not depend on where the bytes differ.
 */
export function verifyWebhook(input: WebhookVerification): boolean {
  if (!/^[0-9]{1,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  if (Math.abs(input.nowSeconds - timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const given = input.signature.split(',').map((part) => part.trim());
  return input.secrets.some((secret) => {
    const expected = Buffer.from(signWebhook(secret, timestamp, input.body));
    return given.some((candidate) => {
      const actual = Buffer.from(candidate);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  });
}

/**
 * Secrets of a subscription, read from their files for every delivery: a rotated file is
 * picked up without a restart. Only the failure code leaves this
 * function; the content and the path never reach an error, a log line or a metric.
 */
export async function readWebhookSecrets(files: readonly string[]): Promise<readonly string[]> {
  const secrets: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = (await readFile(file, 'utf8')).trim();
    } catch {
      throw new WebhookFailure('secret');
    }
    if (Buffer.byteLength(text) < MIN_WEBHOOK_SECRET_BYTES) throw new WebhookFailure('secret');
    secrets.push(text);
  }
  return secrets;
}

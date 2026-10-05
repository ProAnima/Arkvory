import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as console from '../../apps/web/dist/messages.js';
import { CODES } from './languages.ts';

const locales = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/locales');

/** A translator's file of the console: each key's English and its translation. */
function translated(code: string): Record<string, string> | undefined {
  const file = join(locales, `${code}.json`);
  if (!existsSync(file)) return undefined;
  const entries = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { text?: unknown }>;
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, entry]) => typeof entry.text === 'string' && entry.text !== '')
      .map(([key, entry]) => [key, String(entry.text)]),
  );
}

/**
 * The console's texts by language, for `[[ui:key]]` in pages: a page names a button or a
 * screen by the console's own key and shows it as the console does in that language. English
 * and Russian are the console's bundled dictionaries; the others are its locale files.
 */
export function dictionaries(): Record<string, Record<string, string>> {
  const bundled = console as unknown as Record<string, Record<string, string> | undefined>;
  const english = bundled['en'] ?? {};
  return Object.fromEntries(
    CODES.map((code) => [code, { ...english, ...(bundled[code] ?? translated(code) ?? {}) }]),
  );
}

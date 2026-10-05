import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the site itself says in each language: section names, the theme's buttons, the words of
 * generated pages. English (`text/en.json`) is complete; a language's file is laid over it, so a
 * text not yet translated reads in English. `tests/wiki.test.mjs` requires every language to
 * have every English value before a release.
 */
const folder = join(dirname(fileURLToPath(import.meta.url)), 'text');
const read = (code: string): unknown =>
  JSON.parse(readFileSync(join(folder, `${code}.json`), 'utf8'));
const english = read('en') as SiteText;

export type SiteText = typeof import('./text/en.json');

function merge(base: unknown, over: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over ?? base;
  if (typeof over !== 'object' || over === null) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [name, value] of Object.entries(over)) result[name] = merge(result[name], value);
  return result;
}

const cache = new Map<string, SiteText>();
export function siteText(code: string): SiteText {
  let text = cache.get(code);
  if (!text) {
    text = (code === 'en' ? english : merge(english, read(code))) as SiteText;
    cache.set(code, text);
  }
  return text;
}

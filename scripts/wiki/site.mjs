// What every part of the documentation generator shares: the folders, the languages and
// structure of the site (from wiki/.vitepress), and the texts of a language.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const wiki = join(root, 'wiki');
export const REPOSITORY = 'https://github.com/ProAnima/Arkvory';
export const { LANGUAGES, SOURCE } = await import(
  pathToFileURL(join(wiki, '.vitepress/languages.ts')).href
);
export const { SECTIONS, API_PAGES, GENERATED, INTERNAL_ID, COMPLETE } = await import(
  pathToFileURL(join(wiki, '.vitepress/structure.ts')).href
);

export const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
/** A language's folder in the site: English at the root. */
export const prefix = (code) => (code === SOURCE ? '' : `${code}/`);
/** Languages on the site: the source, and every one whose folder has a start page. */
export const present = () =>
  LANGUAGES.filter(({ code }) => code === SOURCE || existsSync(join(wiki, code, 'index.md')));

/** English site texts with a language's file laid over them (as site-text.ts does). */
function merge(base, over) {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over ?? base;
  if (typeof over !== 'object' || over === null) return base;
  const result = { ...base };
  for (const [name, value] of Object.entries(over)) result[name] = merge(result[name], value);
  return result;
}
export const siteText = (code) =>
  merge(
    json(join(wiki, '.vitepress/text/en.json')),
    json(join(wiki, `.vitepress/text/${code}.json`)),
  );
/** Operation and error texts of a language; without a file, the contract's own words. */
export const apiText = (code) => {
  const path = join(wiki, `i18n/api/${code}.json`);
  return existsSync(path) ? json(path) : { operations: {}, errors: { codes: {}, reasons: {} } };
};
export const fill = (text, values) =>
  text.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
/** A table cell: no pipe or line break may end it early. */
export const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');

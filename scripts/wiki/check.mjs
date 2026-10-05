// What a translation must keep of its English original, as problems a translator can act on:
// the same pages, heading ids, console labels and code blocks; every text of the API reference.
// tests/wiki.test.mjs asserts these lists are empty; `npm run wiki -- check <code>` prints them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wiki, json, SOURCE, COMPLETE } from './site.mjs';
import { isStub } from './stubs.mjs';
import { headings } from './headings.mjs';
import { fieldDescriptions, operationText, operations } from './reference.mjs';

const UI = /\[\[ui:([A-Za-z0-9_.-]+)\]\]/g;
const read = (path) => readFileSync(join(wiki, path), 'utf8');
const front = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
export const frontField = (text, name) =>
  new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(front(text))?.[1]?.trim() ?? '';
export const labels = (text) => [...text.matchAll(UI)].map((m) => m[1]).sort();
const fences = (text) => text.split(/\r?\n/).filter((line) => /^\s*(```|~~~)/.test(line)).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Differences of a translated page from the English one; empty when it keeps what it must. */
export function comparePage(code, page) {
  const path = `${code}/${page}.md`;
  if (!existsSync(join(wiki, path))) return [`${path}: missing`];
  const text = read(path);
  const english = read(`${page}.md`);
  // An English stub is allowed where the language is not required to be complete.
  if (isStub(text)) return COMPLETE.includes(code) ? [`${path}: not translated`] : [];
  const problems = [];
  if (!frontField(text, 'title')) problems.push(`${path}: no title`);
  if (frontField(english, 'description') && !frontField(text, 'description'))
    problems.push(`${path}: no description`);
  if (frontField(text, 'layout') !== frontField(english, 'layout'))
    problems.push(`${path}: layout differs`);
  const ids = headings(text).map((h) => h.id);
  const englishIds = headings(english).map((h) => h.id);
  if (!same(ids, englishIds))
    problems.push(
      `${path}: heading ids differ — missing [${englishIds.filter((id) => !ids.includes(id)).join(', ')}], extra [${ids.filter((id) => !englishIds.includes(id)).join(', ')}]${
        englishIds.every((id) => ids.includes(id)) && ids.length === englishIds.length
          ? ', order'
          : ''
      }`,
    );
  if (!same(labels(text), labels(english))) {
    const own = labels(text);
    const source = labels(english);
    problems.push(
      `${path}: [[ui:]] labels differ — missing [${source.filter((k) => !own.includes(k)).join(', ')}], extra [${own.filter((k) => !source.includes(k)).join(', ')}]`,
    );
  }
  if (fences(text) !== fences(english))
    problems.push(
      `${path}: ${String(fences(text) / 2)} code blocks, English has ${String(fences(english) / 2)}`,
    );
  if (/\bSTUB\b/.test(text)) problems.push(`${path}: stub`);
  // A link to the site's root stays in the language: /guide/ is /de/guide/ in German.
  for (const match of text.matchAll(/\]\((\/[^)\s]*)\)|link:\s*(\/\S*)/g)) {
    const target = match[1] ?? match[2] ?? '';
    if (!target.startsWith(`/${code}/`))
      problems.push(`${path}: link ${target} leaves the language`);
  }
  return problems;
}

/** Operations, error texts and field descriptions a language's API reference lacks. */
export async function checkApi(code) {
  const list = await operations();
  const english = json(join(wiki, 'i18n/api/en.json'));
  if (code === SOURCE)
    return list
      .filter((o) => !operationText(o, english).fresh)
      .map((o) => `operation ${o.id}: no text, or the contract changed since it was written`);
  const path = join(wiki, `i18n/api/${code}.json`);
  if (!existsSync(path)) return [`i18n/api/${code}.json: missing`];
  const own = json(path);
  const problems = list
    .filter((o) => !operationText(o, own, english).fresh)
    .map((o) => `operation ${o.id}: not translated from the current English`);
  for (const group of ['codes', 'reasons'])
    for (const name of Object.keys(english.errors[group]))
      if (!own.errors?.[group]?.[name]) problems.push(`errors.${group}.${name}: missing`);
  for (const description of fieldDescriptions(list))
    if (!own.fields?.[description]) problems.push(`fields "${description}": missing`);
  return problems;
}

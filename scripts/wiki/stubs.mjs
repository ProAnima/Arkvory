// A language that is not fully translated shows the English page where its own is missing: a
// stub that includes the English page under a notice in that language. Stubs are files in git, so
// every language has every page; translating a page means overwriting its stub.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { wiki, write, siteText, LANGUAGES, COMPLETE } from './site.mjs';

export const MARKER = '<!-- arkvory-untranslated -->';
const front = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
const field = (text, name) =>
  new RegExp(`^${name}:\s*(.+)$`, 'm').exec(front(text))?.[1]?.trim() ?? '';

export const isStub = (text) => text.includes(MARKER);

/** The stub of an English page in a language: front matter, the notice, the English page. */
export function stubOf(code, page) {
  const english = readFileSync(join(wiki, `${page}.md`), 'utf8');
  const up = '../'.repeat(page.split('/').length);
  // Single quotes, as Prettier writes YAML: a stub stays as the formatter leaves it.
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const meta = parse(front(english)) ?? {};
  return [
    '---',
    `title: ${quote(meta.title)}`,
    ...(meta.description ? [`description: ${quote(meta.description)}`] : []),
    '---',
    '',
    MARKER,
    '',
    '::: warning',
    siteText(code).untranslated,
    ':::',
    '',
    `<!--@include: ${up}${page}.md-->`,
    '',
  ].join('\n');
}

/**
 * Writes (or, with `dryRun`, only lists) the stubs a language lacks or has out of date. A page
 * that is translated is never touched.
 */
export function writeStubs(pages, languages, { dryRun = false } = {}) {
  const changed = [];
  for (const code of languages) {
    if (COMPLETE.includes(code) || !LANGUAGES.some((language) => language.code === code)) continue;
    for (const page of pages) {
      if (page === 'index') continue;
      const path = join(wiki, code, `${page}.md`);
      const stub = stubOf(code, page);
      if (existsSync(path)) {
        const current = readFileSync(path, 'utf8');
        if (!isStub(current) || current === stub) continue;
      }
      changed.push(`${code}/${page}.md`);
      if (!dryRun) write(path, stub);
    }
  }
  return changed;
}

/** Whether a language's page is still the English stub. */
export const isStubPage = (code, page) => {
  const path = join(wiki, code, `${page}.md`);
  return existsSync(path) && isStub(readFileSync(path, 'utf8'));
};

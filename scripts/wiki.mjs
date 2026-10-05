#!/usr/bin/env node
// The documentation site (wiki/, VitePress): generated pages, the build and a live preview.
//
//   npm run wiki -- generate   API reference, error codes and the developers' section
//   npm run wiki -- build      generate, then the site for GitHub Pages -> wiki/.vitepress/dist
//   npm run wiki -- dev        generate, then a live preview at http://localhost:5173/
//   npm run wiki -- ids        give every ## and ### heading of the English pages an explicit id
//   npm run wiki -- stubs     English stubs for the pages a not yet complete language lacks
//   npm run wiki -- check de [guide/index …]   what a translation lacks of the English pages
//
// Generated pages are not in git. They come from the contract the server enforces (OpenAPI,
// operation policies, error codes) and from per-language texts in wiki/i18n/, so the reference
// cannot drift from the API: tests/wiki.test.mjs requires a text for every operation.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, wiki, write, prefix, present, SECTIONS, API_PAGES } from './wiki/site.mjs';
import { operations, pageOf, renderApiPage, errorsPage } from './wiki/reference.mjs';
import { internalSection } from './wiki/internal.mjs';
import { withIds } from './wiki/headings.mjs';
import { checkApi, comparePage } from './wiki/check.mjs';
import { writeStubs, isStubPage } from './wiki/stubs.mjs';

export { operations, operationText, pageOf } from './wiki/reference.mjs';

export async function generate() {
  const list = await operations();
  const groups = new Map(API_PAGES.map((page) => [page, []]));
  for (const operation of list) {
    const page = pageOf(operation);
    if (!groups.has(page)) throw new Error(`${operation.id}: no reference page ${page}`);
    groups.get(page).push(operation);
  }
  for (const { code } of present()) {
    for (const [page, members] of groups)
      write(
        join(wiki, `${prefix(code)}api/reference/${page}.md`),
        renderApiPage(page, members, code),
      );
    write(join(wiki, `${prefix(code)}api/errors.md`), await errorsPage(code));
  }
  // A not yet complete language shows English where its page is missing (stubs.mjs).
  writeStubs(
    writtenPages(),
    present().map((language) => language.code),
  );
  const internal = internalSection();
  console.log(
    `Generated: ${String(list.length)} operations on ${String(groups.size)} pages, error codes, ${String(internal)} developer documents, in ${String(present().length)} languages`,
  );
}

/** The English pages written by hand: the start page and every page of the sections. */
export const writtenPages = () => [
  'index',
  ...SECTIONS.flatMap((section) => section.pages.map((page) => `${section.id}/${page}`)).filter(
    (page) => page !== 'api/errors',
  ),
];

function addIds() {
  let changed = 0;
  for (const page of writtenPages()) {
    const file = join(wiki, `${page}.md`);
    const before = readFileSync(file, 'utf8');
    const after = withIds(before);
    if (after !== before) {
      writeFileSync(file, after);
      changed++;
    }
  }
  console.log(`Heading ids added in ${String(changed)} pages`);
}

/** Prints what a language lacks: of the given pages (all by default) and of the API texts. */
async function check(code, pages) {
  const chosen = pages.length ? pages : writtenPages();
  const problems = chosen.flatMap((page) => (code === 'en' ? [] : comparePage(code, page)));
  if (!pages.length) problems.push(...(await checkApi(code)));
  for (const problem of problems) console.log(problem);
  const left = chosen.filter((page) => isStubPage(code, page));
  if (left.length)
    console.log(`${String(left.length)} pages are still English stubs: ${left.join(', ')}`);
  console.log(`${code}: ${String(problems.length)} problems in ${String(chosen.length)} pages`);
  if (problems.length) process.exitCode = 1;
}

function vitepress(command) {
  const cli = join(root, 'node_modules/vitepress/bin/vitepress.js');
  execFileSync(process.execPath, [cli, command, 'wiki'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(command === 'dev' ? { WIKI_BASE: '/' } : {}) },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'build', ...rest] = process.argv.slice(2);
  if (!['generate', 'build', 'dev', 'ids', 'check', 'stubs'].includes(command))
    throw new Error('Commands: generate, build, dev, ids, stubs, check <language> [pages]');
  if (command === 'ids') addIds();
  else if (command === 'stubs')
    console.log(
      `Stubs written: ${String(
        writeStubs(
          writtenPages(),
          present().map((l) => l.code),
        ).length,
      )}`,
    );
  else if (command === 'check') await check(rest[0] ?? 'en', rest.slice(1));
  else {
    await generate();
    if (command !== 'generate') vitepress(command);
    else console.log(`Pages in ${relative(root, wiki)}/`);
  }
}

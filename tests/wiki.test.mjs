import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  wiki,
  LANGUAGES,
  SOURCE,
  INTERNAL_ID,
  GENERATED,
  COMPLETE,
  json,
} from '../scripts/wiki/site.mjs';
import { headings, slug, withIds } from '../scripts/wiki/headings.mjs';
import { operationText, operations } from '../scripts/wiki/reference.mjs';
import { checkApi, comparePage, frontField as field, labels } from '../scripts/wiki/check.mjs';
import { rulesOf, sample, typeOf } from '../scripts/wiki/schema.mjs';
import { writtenPages } from '../scripts/wiki.mjs';
import { writeStubs } from '../scripts/wiki/stubs.mjs';
import { en as consoleEnglish } from '../apps/web/dist/messages.js';

// A fenced code block, whatever its language: its lines are not headings.
const FENCED = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const OTHERS = LANGUAGES.map(({ code }) => code).filter((code) => code !== SOURCE);
const read = (path) => readFileSync(join(wiki, path), 'utf8');
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** Every leaf of a nested object of texts, by its dotted key. */
const leaves = (value, path = '') =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([name, inner]) => leaves(inner, `${path}${name}.`))
    : [[path.slice(0, -1), value]];

const pages = writtenPages();

test('every English page is written: a title, one heading, no stub', () => {
  for (const page of pages) {
    const text = read(`${page}.md`);
    assert.ok(field(text, 'title'), `${page}: title`);
    if (page !== 'index') {
      // Lines inside code blocks (shell comments) are not headings.
      const prose = text.replace(FENCED, '');
      assert.equal(prose.match(/^# /gm)?.length, 1, `${page}: one # heading`);
    }
    assert.doesNotMatch(text, /\bSTUB\b/, page);
  }
});

test('the front matter of every page is valid YAML', () => {
  const bad = [];
  const walk = (folder) => {
    for (const name of readdirSync(join(wiki, folder))) {
      const path = folder ? `${folder}/${name}` : name;
      if (name.startsWith('.') || name === INTERNAL_ID) continue;
      if (statSync(join(wiki, path)).isDirectory()) walk(path);
      else if (name.endsWith('.md')) {
        const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(path))?.[1];
        try {
          parseYaml(front ?? '');
        } catch (error) {
          bad.push(`${path}: ${String(error.message).split('\n')[0]}`);
        }
      }
    }
  };
  walk('');
  assert.deepEqual(bad, [], 'quote a title or description that contains a colon');
});

test('every ## and ### heading has an explicit id, unique on its page', () => {
  for (const page of pages) {
    const list = headings(read(`${page}.md`));
    assert.deepEqual(
      list.filter((h) => !h.id).map((h) => `${String(h.line)}: ${h.text}`),
      [],
      `${page}: headings without {#id} (npm run wiki -- ids)`,
    );
    const ids = list.map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length, `${page}: repeated id`);
  }
});

test('a page names the console only by labels the console has, with nothing to fill in', () => {
  for (const page of pages)
    for (const key of labels(read(`${page}.md`))) {
      assert.ok(Object.hasOwn(consoleEnglish, key), `${page}: no console text ${key}`);
      assert.doesNotMatch(consoleEnglish[key], /[{}]/, `${page}: ${key} is not a label`);
    }
});

for (const code of OTHERS)
  test(`the ${code} documentation has every page, as the English one is built`, () => {
    assert.deepEqual(
      pages.flatMap((page) => comparePage(code, page)),
      [],
      `npm run wiki -- check ${code}`,
    );
    // Nothing else is written by hand: a page there that English lacks would never be found.
    const extra = [];
    const walk = (folder) => {
      for (const name of readdirSync(join(wiki, folder))) {
        const path = `${folder}/${name}`;
        if (statSync(join(wiki, path)).isDirectory()) walk(path);
        else if (name.endsWith('.md')) {
          const page = path.slice(code.length + 1, -3);
          if (!pages.includes(page) && !GENERATED.includes(page)) extra.push(path);
        }
      }
    };
    if (existsSync(join(wiki, code))) walk(code);
    assert.deepEqual(extra, [], 'pages without an English original');
    assert.equal(
      existsSync(join(wiki, code, INTERNAL_ID)),
      false,
      'developer pages are Russian only',
    );
    // Every page exists: translated, or the English stub of a language that is not complete.
    assert.deepEqual(
      pages.filter((page) => !existsSync(join(wiki, code, `${page}.md`))),
      [],
      'missing pages (npm run wiki -- stubs)',
    );
  });

test('a language that is not complete shows English stubs for what it lacks, up to date', () => {
  const codes = LANGUAGES.map(({ code }) => code);
  assert.deepEqual(writeStubs(pages, codes, { dryRun: true }), [], 'npm run wiki -- stubs');
  for (const code of COMPLETE) assert.ok(codes.includes(code), code);
});

test('the site says everything in every language, with the same values to fill in', () => {
  const english = leaves(json(join(wiki, '.vitepress/text/en.json')));
  for (const code of OTHERS) {
    const own = new Map(leaves(json(join(wiki, `.vitepress/text/${code}.json`))));
    for (const [key, value] of english) {
      const text = own.get(key);
      assert.ok(typeof text === 'string' && text.trim() !== '', `${code}: site text ${key}`);
      assert.deepEqual(placeholders(text), placeholders(value), `${code}: ${key} placeholders`);
    }
    assert.deepEqual(
      [...own.keys()].filter((key) => !english.some(([name]) => name === key)),
      [],
      `${code}: site texts English lacks`,
    );
  }
});

test('every language has the glossary its translators keep to', () => {
  const english = Object.keys(json(join(wiki, 'i18n/terms/en.json'))).sort();
  for (const code of OTHERS) {
    const own = json(join(wiki, `i18n/terms/${code}.json`));
    assert.deepEqual(Object.keys(own).sort(), english, `${code}: glossary keys`);
    for (const [term, text] of Object.entries(own))
      assert.ok(typeof text === 'string' && text.trim() !== '', `${code}: ${term}`);
  }
});

test('the API reference has a current text for every operation in every language', async () => {
  const known = new Set((await operations()).map((o) => o.id));
  const english = json(join(wiki, 'i18n/api/en.json'));
  assert.deepEqual(
    Object.keys(english.operations).filter((id) => !known.has(id)),
    [],
    'stale ids',
  );
  for (const code of [SOURCE, ...OTHERS])
    assert.deepEqual(await checkApi(code), [], `npm run wiki -- check ${code}`);
});

test('an operation shows the contract until its text is redone, and English until translated', () => {
  const operation = { id: 'x', summary: 'Contract', description: '' };
  const english = {
    operations: {
      x: { en: { summary: 'Contract', description: '' }, summary: 'Read', description: 'D' },
    },
  };
  assert.deepEqual(operationText(operation, english), {
    summary: 'Read',
    description: 'D',
    fresh: true,
  });
  const changed = { ...operation, summary: 'Changed' };
  assert.deepEqual(operationText(changed, english), {
    summary: 'Changed',
    description: '',
    fresh: false,
  });
  const german = {
    operations: {
      x: { en: { summary: 'Read', description: 'D' }, summary: 'Lesen', description: 'B' },
    },
  };
  assert.equal(operationText(operation, german, english).summary, 'Lesen');
  const reworded = { operations: { x: { ...english.operations.x, summary: 'Read it' } } };
  assert.deepEqual(operationText(operation, german, reworded), {
    summary: 'Read it',
    description: 'D',
    fresh: false,
  });
});

test('heading ids follow VitePress slugs and skip code blocks', () => {
  assert.equal(slug('Silent installation'), 'silent-installation');
  assert.equal(slug('The `arkvory` command'), 'the-arkvory-command');
  assert.equal(slug('2. Back up first'), '_2-back-up-first');
  const page = '# T\n\n## A b\n\n```bash\n## not a heading\n```\n\n### A b\n\n## Kept {#own}\n';
  assert.equal(
    withIds(page),
    '# T\n\n## A b {#a-b}\n\n```bash\n## not a heading\n```\n\n### A b {#a-b-2}\n\n## Kept {#own}\n',
  );
  assert.deepEqual(
    headings(withIds(page)).map((h) => h.id),
    ['a-b', 'a-b-2', 'own'],
  );
});

test('schema rules read as words, sizes as decimal strings', () => {
  const text = json(join(wiki, '.vitepress/text/en.json')).api;
  assert.equal(
    rulesOf({ type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' }, text),
    text.rules.decimal,
  );
  assert.equal(rulesOf({ type: 'string', minLength: 1, maxLength: 240 }, text), '1–240 characters');
  assert.equal(typeOf({ type: 'array', items: { type: 'string' } }, text), 'array of string');
  assert.equal(typeOf({ oneOf: [{ type: 'string' }, { type: 'null' }] }, text), 'string');
  assert.deepEqual(
    sample({
      type: 'object',
      required: ['size', 'name'],
      properties: {
        size: { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' },
        name: { type: 'string' },
        labels: { type: 'array' },
      },
    }),
    { size: '1024', name: '<name>' },
  );
});

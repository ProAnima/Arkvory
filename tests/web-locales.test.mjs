import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { en, dictionaryFrom, translate } from '../apps/web/dist/messages.js';
import {
  LANGUAGES,
  CODES,
  directionOf,
  intlOf,
  preferredLanguage,
} from '../apps/web/dist/languages.js';

const BUNDLED = ['en', 'ru'];
const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const read = async (code) => JSON.parse(await readFile(`apps/web/locales/${code}.json`, 'utf8'));

test('every language of the console has a dictionary file, and no other file is there', async () => {
  const files = (await readdir('apps/web/locales')).sort();
  const expected = CODES.filter((code) => !BUNDLED.includes(code)).map((code) => `${code}.json`);
  assert.deepEqual(files, expected.sort());
});

for (const code of CODES.filter((code) => !BUNDLED.includes(code)))
  test(`the ${code} dictionary has every English text, translated from the current English`, async () => {
    const entries = await read(code);
    assert.deepEqual(Object.keys(entries).sort(), Object.keys(en).sort(), 'keys');
    const stale = [],
      empty = [],
      parameters = [];
    for (const [key, english] of Object.entries(en)) {
      const entry = entries[key];
      // The English a text was translated from: a change in English makes the translation stale.
      if (entry.en !== english) stale.push(key);
      if (typeof entry.text !== 'string' || entry.text.trim() === '') empty.push(key);
      else if (params(entry.text).join() !== params(english).join()) parameters.push(key);
    }
    assert.deepEqual(stale, [], `English changed since translated (update "en" and "text")`);
    assert.deepEqual(empty, [], 'not translated');
    assert.deepEqual(parameters, [], 'placeholders differ from English');
  });

test('a fetched dictionary falls back to English for a text it lacks', () => {
  const dictionary = dictionaryFrom({ catalog: 'Katalog', search: '', unknown: 'x' });
  assert.equal(dictionary.catalog, 'Katalog');
  assert.equal(dictionary.search, en.search);
  assert.equal(Object.hasOwn(dictionary, 'unknown'), false);
  assert.equal(dictionaryFrom(null).catalog, en.catalog);
  assert.equal(dictionaryFrom(['x']).catalog, en.catalog);
  assert.equal(
    translate(dictionaryFrom({ restored: 'v{revision}' }), 'restored', { revision: 3 }),
    'v3',
  );
});

test('the language follows the saved choice, then the browser, then English', () => {
  assert.equal(preferredLanguage('de', ['ru-RU']), 'de');
  assert.equal(preferredLanguage('xx', ['pt-BR', 'en']), 'pt');
  assert.equal(preferredLanguage(null, ['nl-NL', 'ZH-hans']), 'zh');
  assert.equal(preferredLanguage(null, []), 'en');
  assert.equal(directionOf('ar'), 'rtl');
  assert.equal(directionOf('ja'), 'ltr');
  // Sizes and ports keep Latin digits in Arabic.
  assert.match(new Intl.NumberFormat(intlOf('ar')).format(1024), /^\D*1\D?024\D*$/);
  assert.equal(LANGUAGES.length, new Set(CODES).size);
});

test('the documentation lists the console languages', async () => {
  const source = await readFile('wiki/.vitepress/languages.ts', 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/apps\/web\/src\/languages\.ts'/);
});

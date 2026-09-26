import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { en, ru, translate } from '../apps/web/dist/messages.js';
import {
  themePreference,
  languagePreference,
  readPreference,
  savePreference,
} from '../apps/web/dist/preferences.js';

test('localization covers every UI key and keeps interpolation parameters consistent', async () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(en)) {
    assert(ru[key].length > 0, key);
    assert.deepEqual(params(en[key]), params(ru[key]), key);
  }
  const html = await readFile('apps/web/index.html', 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-label|-placeholder)?="([^"]+)"/g))
    assert(Object.hasOwn(en, match[1]), match[1]);
  for (const match of html.matchAll(/data-help="([^"]+)"/g))
    assert(Object.hasOwn(en, match[1]), match[1]);
  assert.equal(
    translate('en', 'historyCount', { count: 50, revision: 101 }),
    '50 revisions loaded · Current r101',
  );
  assert.equal(translate('ru', 'restored', { revision: 3 }), 'Восстановлено как ревизия 3');
});

test('preferences fall back safely and denied browser storage is optional', () => {
  assert.equal(themePreference('unknown'), 'system');
  assert.equal(themePreference('dark'), 'dark');
  assert.equal(languagePreference(null, 'ru-RU'), 'ru');
  assert.equal(languagePreference('invalid', 'de-DE'), 'en');
  assert.equal(languagePreference('en', 'ru-RU'), 'en');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied');
    },
  });
  try {
    assert.equal(readPreference('theme'), null);
    assert.doesNotThrow(() => savePreference('language', 'ru'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('both themes meet text contrast requirements and components use centralized colors', async () => {
  const css = await readFile('apps/web/tokens.css', 'utf8');
  const declarations = (block) =>
    Object.fromEntries(
      [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
  const light = declarations(css.split(":root[data-theme='dark']")[0]);
  const dark = {
    ...light,
    ...declarations(css.split(":root[data-theme='dark']")[1].split('/* Breakpoints')[0]),
  };
  const luminance = (hex) => {
    assert.match(hex, /^#[a-f\d]{6}$/i);
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const palette of [light, dark]) {
    const value = (key) =>
      palette[key].startsWith('var(') ? value(palette[key].slice(4, -1)) : palette[key];
    for (const [fg, bg] of [
      ['text', 'surface'],
      ['muted', 'surface'],
      ['muted', 'bg'],
      ['on-accent', 'accent'],
      ['error', 'bg'],
      ['success', 'surface'],
      ['nav-text', 'nav-active'],
      ['text', 'tooltip'],
      ['muted', 'raised'],
      ['muted', 'sidebar'],
      ['muted', 'info-bg'],
      ['text', 'input'],
      ['on-accent', 'accent-hover'],
      ['on-selection', 'selection'],
    ]) {
      const a = luminance(value(`--color-${fg}`)),
        b = luminance(value(`--color-${bg}`));
      assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${fg} on ${bg}`);
    }
    for (const [fg, bg] of [
      ['border-strong', 'input'],
      ['focus', 'surface'],
      ['focus', 'bg'],
    ]) {
      const a = luminance(value(`--color-${fg}`)),
        b = luminance(value(`--color-${bg}`));
      assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3, `${fg} on ${bg}`);
    }
  }
  const componentFiles = (await readdir('apps/web')).filter(
    (file) => file.endsWith('.css') && file !== 'tokens.css',
  );
  const components = (
    await Promise.all(componentFiles.map((file) => readFile(`apps/web/${file}`, 'utf8')))
  ).join('\n');
  assert.doesNotMatch(components, /#[a-f\d]{3,8}\b|\b(?:rgb|hsl|oklch)\(/i);
  for (const match of components.matchAll(/var\((--[\w-]+)\)/g))
    assert(Object.hasOwn(light, match[1]), match[1]);
});

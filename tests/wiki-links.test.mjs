import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMarkdownRenderer } from 'vitepress';
import { apiFragments } from '../wiki/.vitepress/api-fragments.ts';
import { operations } from '../scripts/wiki/reference.mjs';
import { root, LANGUAGES, prefix } from '../scripts/wiki/site.mjs';

test('every API operation link reaches its case-sensitive heading in the built site', async () => {
  const md = await createMarkdownRenderer(root, { config: apiFragments }, '/Arkvory/');
  for (const { id } of await operations()) {
    const html = md.render(`[operation](/api/reference/system#${id})\n\n## Operation {#${id}}`);
    assert.ok(html.includes(`href="/Arkvory/api/reference/system.html#${id}"`), id);
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test('API fragments retain path normalization, external attributes and ordinary heading slugs', async () => {
  const md = await createMarkdownRenderer(root, { config: apiFragments }, '/Arkvory/');
  const html = md.render(
    '[relative](../reference/system.md?view=full#getSystemLicense)\n\n' +
      '[local](#getSystemLicense)\n\n' +
      '[outside](https://example.com/docs#getSystemLicense)\n\n' +
      '[ordinary](#Silent%20installation)',
  );
  const relative = /<a href="([^"]+)">relative/.exec(html)?.[1];
  assert.ok(relative);
  assert.equal(
    new URL(relative, 'https://docs.example/Arkvory/guide/example').href,
    'https://docs.example/Arkvory/reference/system.html?view=full#getSystemLicense',
  );
  assert.ok(html.includes('href="#getSystemLicense"'));
  assert.ok(html.includes('href="https://example.com/docs#getSystemLicense" target="_blank"'));
  assert.ok(html.includes('href="#silent-installation"'));
});

test('quoted attribution links never include translated punctuation in the repository URL', async () => {
  const md = await createMarkdownRenderer(root);
  const repository = 'https://github.com/ProAnima/Arkvory';
  const paths = [
    'README.md',
    'README.ru.md',
    'LICENSE.md',
    'LICENSE.ru.md',
    ...LANGUAGES.map(({ code }) => `wiki/${prefix(code)}reference/faq.md`),
  ];
  for (const path of paths) {
    const html = md.render(readFileSync(join(root, path), 'utf8'));
    const links = [...html.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((href) => href.startsWith(repository));
    assert.ok(links.includes(repository), path);
    for (const href of links)
      assert.ok(href === repository || href.startsWith(`${repository}/`), path);
  }
});

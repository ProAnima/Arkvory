import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MiniSearch from 'minisearch';
import { defineConfig, type DefaultTheme } from 'vitepress';
import { LANGUAGES, CODES, SOURCE } from './languages.ts';
import { SECTIONS, API_PAGES, INTERNAL_ID } from './structure.ts';
import { siteText } from './site-text.ts';
import { tokenize } from './tokenize.ts';
import { uiLabels } from './ui-labels.ts';
import { vueSafe } from './vue-safe.ts';
import { dictionaries } from './console-labels.ts';

// The search index in words as each script has them: Chinese and Japanese have no spaces
// between words (tokenize.ts). The build's own MiniSearch is given the tokenizer here, and
// the browser reads queries with the same one (theme/index.ts).
const add = MiniSearch.prototype.add;
MiniSearch.prototype.add = function (
  this: MiniSearch & { _options: { tokenize: typeof tokenize } },
  document,
) {
  this._options.tokenize = tokenize;
  return add.call(this, document);
};

const wiki = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(wiki, '..');
const REPOSITORY = 'https://github.com/ProAnima/Arkvory';
/** `/Arkvory/` on GitHub Pages; `/` for a local preview (WIKI_BASE). */
const base = process.env['WIKI_BASE'] ?? '/Arkvory/';

/** A page's `title:` from its front matter: the sidebar says what the page says it is. */
function titleOf(page: string): string {
  const file = join(wiki, `${page}.md`);
  if (!existsSync(file))
    throw new Error(`wiki/${page}.md is missing (generated pages: npm run wiki -- generate)`);
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  const title = front && /^title:\s*(.+)$/m.exec(front[1] ?? '');
  if (!title?.[1]) throw new Error(`wiki/${page}.md has no title in its front matter`);
  return title[1].trim().replace(/^(["'])(.*)\1$/, '$2');
}
const linkTo = (page: string) => `/${page.replace(/(^|\/)index$/, '$1')}`;

/** The developers' pages, copied from docs/ by the generator: the folder lists them. */
function internalPages(): string[] {
  const folder = join(wiki, INTERNAL_ID);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.md') && name !== 'index.md')
    .map((name) => `${INTERNAL_ID}/${name.slice(0, -3)}`)
    .sort();
}

function sidebar(code: string): DefaultTheme.SidebarItem[] {
  const prefix = code === SOURCE ? '' : `${code}/`;
  const text = siteText(code);
  const page = (path: string) => ({
    text: titleOf(`${prefix}${path}`),
    link: linkTo(`${prefix}${path}`),
  });
  const internal = existsSync(join(wiki, INTERNAL_ID, 'index.md'))
    ? [
        {
          text: `${text.sections.internal} (${text.internalOnly})`,
          collapsed: true,
          items: [
            { text: titleOf(`${INTERNAL_ID}/index`), link: linkTo(`${INTERNAL_ID}/index`) },
            ...internalPages().map((path) => ({ text: titleOf(path), link: linkTo(path) })),
          ],
        },
      ]
    : [];
  return [
    ...SECTIONS.map((section) => ({
      text: text.sections[section.id as keyof typeof text.sections],
      collapsed: false,
      items: section.pages.map((name) => page(`${section.id}/${name}`)),
    })),
    {
      text: text.sections.apiReference,
      collapsed: true,
      items: API_PAGES.map((name) => page(`api/reference/${name}`)),
    },
    ...internal,
  ];
}

function themeOf(code: string): DefaultTheme.Config {
  const text = siteText(code);
  const home = code === SOURCE ? '/' : `/${code}/`;
  const common = text.common;
  return {
    nav: [
      { text: text.sections.guide, link: `${home}guide/` },
      { text: text.sections.install, link: `${home}install/` },
      { text: text.sections.api, link: `${home}api/` },
      { text: common.download, link: `${REPOSITORY}/releases/latest` },
    ],
    sidebar: sidebar(code),
    outline: { level: [2, 3], label: common.outline },
    docFooter: { prev: common.prev, next: common.next },
    returnToTopLabel: common.returnToTop,
    sidebarMenuLabel: common.sidebarMenu,
    darkModeSwitchLabel: common.appearance,
    lightModeSwitchTitle: common.lightTheme,
    darkModeSwitchTitle: common.darkTheme,
    langMenuLabel: common.langMenu,
    skipToContentLabel: common.skipToContent,
    editLink: { pattern: `${REPOSITORY}/edit/main/wiki/:path`, text: common.editLink },
    notFound: {
      title: common.notFound.title,
      quote: common.notFound.quote,
      linkText: common.notFound.link,
      linkLabel: common.notFound.linkLabel,
    },
  };
}

function searchText(code: string) {
  const text = siteText(code).common.search;
  return {
    translations: {
      button: { buttonText: text.button, buttonAriaLabel: text.button },
      modal: {
        displayDetails: text.details,
        resetButtonTitle: text.reset,
        backButtonTitle: text.back,
        noResultsText: text.noResults,
        footer: {
          selectText: text.select,
          selectKeyAriaLabel: 'Enter',
          navigateText: text.navigate,
          navigateUpKeyAriaLabel: '↑',
          navigateDownKeyAriaLabel: '↓',
          closeText: text.close,
          closeKeyAriaLabel: 'Esc',
        },
      },
    },
  };
}

const key = (code: string) => (code === SOURCE ? 'root' : code);
/** A language is on the site once its folder has a start page; the test requires all of them. */
const PRESENT = LANGUAGES.filter(
  (language) => language.code === SOURCE || existsSync(join(wiki, language.code, 'index.md')),
);
/** A page's language: the first folder when it is one, the source language otherwise. */
const languageOf = (relativePath: string) => {
  // VitePress gives posix paths; a Windows separator is accepted too.
  const first = relativePath.replaceAll(String.fromCharCode(92), '/').split('/')[0] ?? '';
  return (CODES as readonly string[]).includes(first) ? first : SOURCE;
};
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

export default defineConfig({
  base,
  srcDir: '.',
  outDir: process.env['WIKI_OUT'] ?? '.vitepress/dist',
  cacheDir: '.vitepress/cache',
  cleanUrls: true,
  // The local search index is one chunk per language; large by design.
  vite: { build: { chunkSizeWarningLimit: 4096 } },
  lastUpdated: false,
  title: 'Arkvory',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}arkvory.svg` }]],
  locales: Object.fromEntries(
    PRESENT.map((language) => [
      key(language.code),
      {
        label: language.name,
        lang: language.code,
        dir: 'dir' in language ? language.dir : 'ltr',
        link: language.code === SOURCE ? '/' : `/${language.code}/`,
        description: siteText(language.code).description,
        themeConfig: themeOf(language.code),
      },
    ]),
  ),
  themeConfig: {
    logo: { src: '/arkvory.svg', alt: '' },
    siteTitle: 'Arkvory',
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    footer: { message: `Arkvory ${version === '0.0.0' ? '' : version} · ProAnimaStudio` },
    search: {
      provider: 'local',
      options: {
        locales: Object.fromEntries(PRESENT.map(({ code }) => [key(code), searchText(code)])),
      },
    },
  },
  markdown: {
    // An untranslated page includes the English one; its links stay relative to the page shown.
    include: { rebaseRelativeUrls: false },
    config: (md) => {
      uiLabels(md, dictionaries(), languageOf);
      vueSafe(md);
    },
  },
});

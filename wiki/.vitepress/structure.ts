/**
 * The documentation's pages in reading order: one list for every language. A page's title is
 * the `title:` of its own file in each language; a section's name is in `text/<code>.json`.
 * `tests/wiki.test.mjs` checks that every language has exactly these pages, and that the
 * developers' section stays in Russian only (engineering documents, AGENTS.md).
 */
export interface Section {
  /** The folder, and the key of its name under `sections`. */
  readonly id: string;
  readonly pages: readonly string[];
}

export const SECTIONS: readonly Section[] = [
  { id: 'guide', pages: ['index', 'concepts', 'quick-start', 'console'] },
  {
    id: 'install',
    pages: ['index', 'windows', 'linux', 'docker', 'configuration', 'https', 'updates'],
  },
  {
    id: 'use',
    pages: ['accounts', 'repositories', 'transfers', 'packages', 'files', 'promotion'],
  },
  {
    id: 'protocols',
    pages: ['index', 'cli', 'sdk', 'containers', 'git-lfs', 'unity-npm', 'raw-files'],
  },
  {
    id: 'operate',
    pages: [
      'backups',
      'mirrors',
      'read-gateways',
      'storage',
      'monitoring',
      'self-healing',
      'security',
      'troubleshooting',
    ],
  },
  { id: 'api', pages: ['index', 'authentication', 'errors'] },
  { id: 'reference', pages: ['environment', 'glossary', 'faq'] },
];

/**
 * The HTTP API reference: one generated page per group of operations, in every language
 * (`scripts/wiki.mjs generate`, from the OpenAPI document and `api/<code>.json`).
 */
export const API_PAGES = [
  'system',
  'repositories',
  'uploads',
  'artifacts',
  'packages',
  'files',
  'promotion',
  'storage',
  'mirrors',
  'links',
  'attachments',
  'accounts',
  'services',
  'backups',
  'updates',
  'feedback',
] as const;

/**
 * Languages whose pages must all be translated. Any other language may show an English page
 * (a stub that includes it, with a notice) until someone translates it; `npm run wiki -- stubs`
 * writes the stubs and `npm run wiki -- check <code>` lists what is left.
 */
export const COMPLETE: readonly string[] = ['en', 'ru', 'es', 'de', 'zh', 'hi', 'ko', 'fr', 'pt'];

/** Pages written by the generator before a build; not in git. */
export const GENERATED = ['api/errors', ...API_PAGES.map((page) => `api/reference/${page}`)];

/** For developers, in Russian only: copied from docs/ at build time (`scripts/wiki.mjs`). */
export const INTERNAL_ID = 'internal';

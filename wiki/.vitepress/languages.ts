/**
 * The documentation is in the console's languages: one list, kept with the console
 * (apps/web/src/languages.ts). Adding a language is a folder of pages here, a site text file
 * (`text/<code>.json`) and a console dictionary; the tests check that each has everything
 * English has.
 */
export {
  LANGUAGES,
  CODES,
  SOURCE,
  type Language as LanguageCode,
  type LanguageInfo as Language,
} from '../../apps/web/src/languages.ts';

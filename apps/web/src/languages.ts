/**
 * The languages of the console and of the documentation (wiki/.vitepress/languages.ts reads this
 * list), in the order the switch shows them. English and Russian are in the bundle; every other
 * dictionary is `apps/web/locales/<code>.json`, fetched when its language is chosen.
 * `tests/web-locales.test.mjs` checks that each has every English text.
 */
export interface LanguageInfo {
  /** BCP 47 code: the dictionary, `<html lang>`, the folder of the documentation. */
  readonly code: string;
  /** The language's own name, as a person who reads it looks for it. */
  readonly name: string;
  /** Right to left (Arabic): the page mirrors; keys, hashes and addresses stay left to right. */
  readonly dir?: 'rtl';
  /** The tag for numbers and dates where it is not `code` (Arabic: Latin digits, as sizes and ports have). */
  readonly intl?: string;
  /** Two letters beside the flag on the switch's button. */
  readonly short: string;
  /**
   * The flag shown beside the language: a picture only, apps/web/flags/<flag>.svg (flag-icons,
   * MIT). A flag is a country, not a language: English is shown with the United Kingdom's,
   * Portuguese with Brazil's (the translation is Brazilian), Arabic with Saudi Arabia's.
   */
  readonly flag: string;
}

export const LANGUAGES = [
  { code: 'en', name: 'English', short: 'EN', flag: 'gb' },
  { code: 'ru', name: 'Русский', short: 'RU', flag: 'ru' },
  { code: 'es', name: 'Español', short: 'ES', flag: 'es' },
  { code: 'fr', name: 'Français', short: 'FR', flag: 'fr' },
  { code: 'de', name: 'Deutsch', short: 'DE', flag: 'de' },
  { code: 'pt', name: 'Português', short: 'PT', flag: 'br' },
  { code: 'zh', name: '中文', short: 'ZH', flag: 'cn' },
  { code: 'ja', name: '日本語', short: 'JA', flag: 'jp' },
  { code: 'ko', name: '한국어', short: 'KO', flag: 'kr' },
  { code: 'hi', name: 'हिन्दी', short: 'HI', flag: 'in' },
  { code: 'ar', name: 'العربية', short: 'AR', flag: 'sa', dir: 'rtl', intl: 'ar-u-nu-latn' },
] as const satisfies readonly LanguageInfo[];

export type Language = (typeof LANGUAGES)[number]['code'];

/** The language every other one is translated from. */
export const SOURCE: Language = 'en';

export const CODES: readonly Language[] = LANGUAGES.map((language) => language.code);

export function isLanguage(value: string): value is Language {
  return (CODES as readonly string[]).includes(value);
}

function infoOf(code: Language): LanguageInfo {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

export function directionOf(code: Language): 'ltr' | 'rtl' {
  return infoOf(code).dir ?? 'ltr';
}

/** The locale `Intl` formats numbers, sizes and dates with. */
export function intlOf(code: Language): string {
  return infoOf(code).intl ?? code;
}

/**
 * The saved choice when it is a language of the console; otherwise the first of the browser's
 * languages the console has (`de-AT` reads German); otherwise English.
 */
export function preferredLanguage(saved: string | null, browser: readonly string[]): Language {
  if (saved !== null && isLanguage(saved)) return saved;
  for (const tag of browser) {
    const primary = tag.toLowerCase().split('-')[0] ?? '';
    if (isLanguage(primary)) return primary;
  }
  return SOURCE;
}

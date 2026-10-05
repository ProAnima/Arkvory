import { preferredLanguage, type Language } from './languages.js';
export type Theme = 'light' | 'dark' | 'system';
export function themePreference(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function languagePreference(
  value: string | null,
  browserLanguages: string | readonly string[],
): Language {
  return preferredLanguage(
    value,
    typeof browserLanguages === 'string' ? [browserLanguages] : browserLanguages,
  );
}
export function readPreference(key: 'theme' | 'language'): string | null {
  try {
    return localStorage.getItem(`arkvory.ui.${key}`);
  } catch {
    return null;
  }
}
export function savePreference(key: 'theme' | 'language', value: string) {
  try {
    localStorage.setItem(`arkvory.ui.${key}`, value);
  } catch {
    /* Preferences are optional in restricted browsers. */
  }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset['theme'] =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
}

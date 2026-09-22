import type { Language } from './messages.js';
export type Theme = 'light' | 'dark' | 'system';
export function themePreference(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function languagePreference(value: string | null, browserLanguage: string): Language {
  return value === 'en' || value === 'ru'
    ? value
    : browserLanguage.toLowerCase().startsWith('ru')
      ? 'ru'
      : 'en';
}
export function readPreference(key: 'theme' | 'language'): string | null {
  try {
    return localStorage.getItem(`depot.ui.${key}`);
  } catch {
    return null;
  }
}
export function savePreference(key: 'theme' | 'language', value: string) {
  try {
    localStorage.setItem(`depot.ui.${key}`, value);
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

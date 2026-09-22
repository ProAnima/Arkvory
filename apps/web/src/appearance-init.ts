import { applyTheme, themePreference, readPreference, languagePreference } from './preferences.js';
applyTheme(themePreference(readPreference('theme')));
document.documentElement.lang = languagePreference(readPreference('language'), navigator.language);

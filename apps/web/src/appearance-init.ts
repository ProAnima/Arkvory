import { applyTheme, themePreference, readPreference, languagePreference } from './preferences.js';
import { directionOf } from './languages.js';
applyTheme(themePreference(readPreference('theme')));
// Before the first paint: the page mirrors for Arabic before the console script arrives.
const language = languagePreference(readPreference('language'), navigator.languages);
document.documentElement.lang = language;
document.documentElement.dir = directionOf(language);

import MiniSearch from 'minisearch';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { CODES, SOURCE } from '../languages.ts';
import { tokenize } from '../tokenize.ts';
import './custom.css';

// The search box reads the index the build wrote with this tokenizer; its queries must be cut
// into words the same way (see tokenize.ts).
const load = MiniSearch.loadJSON.bind(MiniSearch);
MiniSearch.loadJSON = ((json: string, options: Parameters<typeof MiniSearch.loadJSON>[1]) =>
  load(json, {
    ...options,
    tokenize,
    searchOptions: { ...options?.searchOptions, tokenize },
  })) as typeof MiniSearch.loadJSON;

const CHECKED = 'arkvory-wiki.language-checked';

/**
 * The start page, opened for the first time, in the reader's language when the documentation
 * has it, as the console picks its language. Only once: whoever then chooses English stays.
 */
function firstVisit() {
  const base = import.meta.env.BASE_URL;
  if (location.pathname !== base && location.pathname !== `${base}index.html`) return;
  try {
    if (localStorage.getItem(CHECKED)) return;
    localStorage.setItem(CHECKED, '1');
  } catch {
    return;
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split('-')[0] ?? '';
    if (code === SOURCE) return;
    if ((CODES as readonly string[]).includes(code)) {
      location.replace(`${base}${code}/`);
      return;
    }
  }
}

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') firstVisit();
  },
} satisfies Theme;

import { element } from './dom.js';
import { initializeLanguage, message, setLanguage } from './i18n.js';
import { themePreference, readPreference, savePreference, applyTheme } from './preferences.js';
const views = {
  catalog: 'catalogSubtitle',
  packages: 'packagesSubtitle',
  administration: 'administrationSubtitle',
  upload: 'uploadSubtitle',
  downloads: 'downloadsSubtitle',
  history: 'historySubtitle',
  metadata: 'metadataSubtitle',
} as const;
type View = keyof typeof views;
function isView(value: string): value is View {
  return Object.hasOwn(views, value);
}
export function showView(view: View) {
  for (const panel of document.querySelectorAll<HTMLElement>('[data-view]'))
    panel.hidden = panel.dataset['view'] !== view;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]')) {
    const selected = button.dataset['nav'] === view;
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  }
  message(element('page-title', HTMLHeadingElement), view);
  message(element('page-description', HTMLParagraphElement), views[view]);
  element('page-title', HTMLHeadingElement).focus({ preventScroll: true });
}
export function initializeShell() {
  const language = element('language', HTMLSelectElement);
  language.value = initializeLanguage();
  language.onchange = () => {
    if (language.value === 'ru' || language.value === 'en') setLanguage(language.value);
  };
  const theme = element('theme', HTMLSelectElement);
  theme.value = themePreference(readPreference('theme'));
  theme.onchange = () => {
    const value = themePreference(theme.value);
    savePreference('theme', value);
    applyTheme(value);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system');
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav], [data-go]'))
    button.onclick = () => {
      const value = button.dataset['nav'] ?? button.dataset['go'];
      if (value && isView(value)) showView(value);
    };
}

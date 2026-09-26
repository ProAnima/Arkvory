import { initializeTooltips } from './tooltips.js';
import { initializeFileInputs } from './file-inputs.js';
import { element } from './dom.js';
import { initializeLanguage, message, setLanguage } from './i18n.js';
import { themePreference, readPreference, savePreference, applyTheme } from './preferences.js';
import { initializeGuides } from './guides.js';
const views = {
  catalog: 'catalogSubtitle',
  repositories: 'repositoriesSubtitle',
  services: 'servicesSubtitle',
  packages: 'packagesSubtitle',
  administration: 'administrationSubtitle',
  updates: 'updatesSubtitle',
  upload: 'uploadSubtitle',
  downloads: 'downloadsSubtitle',
  history: 'historySubtitle',
  metadata: 'metadataSubtitle',
  onboarding: 'onboardingSubtitle',
  help: 'helpSubtitle',
} as const;
type View = keyof typeof views;
function isView(value: string): value is View {
  return Object.hasOwn(views, value);
}
export function showView(view: View) {
  element('global-feedback', HTMLDivElement).hidden = true;
  for (const panel of document.querySelectorAll<HTMLElement>('[data-view]'))
    panel.hidden = panel.dataset['view'] !== view;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]')) {
    const selected = button.dataset['nav'] === view;
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  }
  message(element('page-title', HTMLHeadingElement), view);
  message(element('page-description', HTMLParagraphElement), views[view]);
  element('heading-upload', HTMLButtonElement).hidden = ![
    'catalog',
    'packages',
    'history',
  ].includes(view);
  element('workspace-navigation', HTMLElement).dataset['expanded'] = 'false';
  element('navigation-toggle', HTMLButtonElement).setAttribute('aria-expanded', 'false');
  element('page-title', HTMLHeadingElement).focus({ preventScroll: true });
  // A shorter destination must not leave the user below its heading after a long form.
  element('page-title', HTMLHeadingElement).scrollIntoView({ block: 'nearest' });
}
export function initializeShell() {
  initializeGuides();
  initializeTooltips();
  initializeFileInputs();
  const toggle = element('navigation-toggle', HTMLButtonElement);
  const navigation = element('workspace-navigation', HTMLElement);
  toggle.onclick = () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    navigation.dataset['expanded'] = String(expanded);
  };
  navigation.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      navigation.dataset['expanded'] = 'false';
      toggle.focus();
    }
  });
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
  for (const button of document.querySelectorAll<HTMLElement>('[data-nav], [data-go]'))
    button.onclick = (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const value = button.dataset['nav'] ?? button.dataset['go'];
      if (value && isView(value)) {
        event.preventDefault();
        showView(value);
      }
    };
  if (location.hash === '#onboarding') showView('onboarding');
  if (location.hash === '#help') showView('help');
  document.documentElement.dataset['appearanceReady'] = 'true';
}

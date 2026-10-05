import { initializeTooltips } from './tooltips.js';
import { initializeFileInputs } from './file-inputs.js';
import { element } from './dom.js';
import { currentLanguage, message, setLanguage } from './i18n.js';
import { LANGUAGES, isLanguage } from './languages.js';
import { themePreference, readPreference, savePreference, applyTheme } from './preferences.js';
import { initializeGuides } from './guides.js';
import { initializeActionTooltips } from './action-tooltips.js';
import { initializeAppearanceControls } from './appearance-controls.js';
import { initializeStaticIcons } from './icons.js';
import { formatRoute, isView } from './routes.js';
import type { View } from './routes.js';
export type { View } from './routes.js';

type HistoryMode = 'push' | 'replace' | 'keep';
const openers = new Map<View, (() => void)[]>();
let artifactRoute: string | undefined;

/** Loads data for a screen the person opened (navigation, link or Back), not for redirects. */
export function onViewOpen(view: View, open: () => void) {
  openers.set(view, [...(openers.get(view) ?? []), open]);
}
export function openView(view: View, mode: HistoryMode = 'push') {
  showView(view, { history: mode });
  for (const open of openers.get(view) ?? []) open();
}
/** The details screen links to the selected artifact while one is open. */
export function setArtifactRoute(route: string | undefined) {
  artifactRoute = route;
}

export function showView(
  view: View,
  options: { readonly route?: string; readonly history?: HistoryMode } = {},
) {
  element('global-feedback', HTMLDivElement).hidden = true;
  for (const panel of document.querySelectorAll<HTMLElement>('[data-view]'))
    panel.hidden = panel.dataset['view'] !== view;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]')) {
    const selected = button.dataset['nav'] === view;
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  }
  message(element('page-title', HTMLHeadingElement), view);
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
  const route =
    options.route ??
    (view === 'metadata' ? artifactRoute : undefined) ??
    formatRoute({ kind: 'view', view });
  const mode = options.history ?? 'push';
  if (mode !== 'keep' && location.hash !== route) {
    if (mode === 'push') history.pushState(null, '', route);
    else history.replaceState(null, '', route);
  }
}
export function initializeShell() {
  initializeStaticIcons();
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
  // Each language by its own name, in its own script and direction, whatever the page is in.
  language.replaceChildren(
    ...LANGUAGES.map(({ code, name, ...info }) => {
      const option = new Option(name, code);
      option.lang = code;
      option.dir = 'dir' in info ? info.dir : 'ltr';
      return option;
    }),
  );
  language.value = currentLanguage();
  language.onchange = () => {
    const chosen = language.value;
    if (!isLanguage(chosen)) return;
    void setLanguage(chosen).then((applied) => {
      // Not fetched (or overtaken by a later choice): the switch shows what the page is in.
      if (!applied) language.value = currentLanguage();
    });
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
  initializeAppearanceControls();
  initializeActionTooltips();
  for (const button of document.querySelectorAll<HTMLElement>('[data-nav], [data-go]'))
    button.onclick = (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const value = button.dataset['nav'] ?? button.dataset['go'];
      if (value && isView(value)) {
        event.preventDefault();
        openView(value);
      }
    };
  document.documentElement.dataset['appearanceReady'] = 'true';
}

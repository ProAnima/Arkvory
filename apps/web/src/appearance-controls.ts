import { element } from './dom.js';
import { icon } from './icons.js';
import { message, t } from './i18n.js';

export function initializeAppearanceControls() {
  const theme = element('theme', HTMLSelectElement);
  const language = element('language', HTMLSelectElement);
  const themeIcon = element('theme-icon', HTMLSpanElement);
  const update = () => {
    const name = theme.value === 'light' ? 'sun' : theme.value === 'dark' ? 'moon' : 'monitor';
    themeIcon.replaceChildren(icon(name));
    theme.setAttribute(
      'aria-label',
      t('themeCurrent', {
        value: t(theme.value === 'light' ? 'light' : theme.value === 'dark' ? 'dark' : 'system'),
      }),
    );
    const nativeHelp = typeof HTMLElement.prototype.showPopover !== 'function';
    theme.title = nativeHelp ? (theme.getAttribute('aria-label') ?? t('theme')) : '';
    language.setAttribute('aria-label', t('language'));
    language.title = nativeHelp ? t('language') : '';
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]'))
      button.title = nativeHelp ? button.textContent.trim() : '';
  };
  element('language-icon', HTMLSpanElement).replaceChildren(icon('language'));
  theme.addEventListener('change', update);
  language.addEventListener('change', update);
  const toggle = element('sidebar-toggle', HTMLButtonElement);
  const sync = () => {
    const compact = document.documentElement.dataset['navigation'] === 'compact';
    toggle.setAttribute('aria-expanded', String(!compact));
    message(toggle, compact ? 'navigationExpand' : 'navigationCollapse');
  };
  toggle.onclick = () => {
    document.documentElement.dataset['navigation'] =
      document.documentElement.dataset['navigation'] === 'compact' ? 'expanded' : 'compact';
    sync();
  };
  sync();
  update();
}

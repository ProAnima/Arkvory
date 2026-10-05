import { element } from './dom.js';
import { currentLanguage, onLanguageChange, setLanguage, t } from './i18n.js';
import { icon } from './icons.js';
import { LANGUAGES, type Language } from './languages.js';

/** The parts of the menu: its button, the popover list and one item per language. */
interface Menu {
  readonly button: HTMLButtonElement;
  readonly list: HTMLElement;
  readonly current: HTMLElement;
  readonly items: ReadonlyMap<Language, HTMLButtonElement>;
}

/** A flag, beside the console's script (wherever the console is served from). */
const flagUrl = (flag: string) => new URL(`flags/${flag}.svg`, import.meta.url).href;

/** A language's name in another language, for finding it by a letter; empty where there is none. */
function nameIn(code: string, inLanguage: string): string {
  try {
    return new Intl.DisplayNames([inLanguage], { type: 'language' }).of(code) ?? '';
  } catch {
    return '';
  }
}

function flag(file: string) {
  const image = document.createElement('img');
  image.className = 'flag';
  image.src = flagUrl(file);
  image.alt = '';
  image.width = 20;
  image.height = 15;
  image.draggable = false;
  return image;
}

function closeList(menu: Menu) {
  try {
    menu.list.hidePopover();
  } catch {
    // Not shown.
  }
  menu.button.focus();
}

/** One item per language: its flag, its own name in its own script and direction, a check. */
function buildItems(list: HTMLElement, choose: (code: Language) => void) {
  const items = new Map<Language, HTMLButtonElement>();
  for (const info of LANGUAGES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.tabIndex = -1;
    item.dataset['lang'] = info.code;
    const name = document.createElement('span');
    name.className = 'lang-menu-name';
    name.lang = info.code;
    name.dir = 'dir' in info ? info.dir : 'ltr';
    name.textContent = info.name;
    const check = document.createElement('span');
    check.className = 'lang-menu-check';
    check.setAttribute('aria-hidden', 'true');
    item.append(flag(info.flag), name, check);
    item.onclick = () => {
      choose(info.code);
    };
    items.set(info.code, item);
    list.append(item);
  }
  return items;
}

/** Shows the language the page is in: the button's flag and letters, the checked item. */
function render(menu: Menu) {
  const language = currentLanguage();
  const info = LANGUAGES.find(({ code }) => code === language) ?? LANGUAGES[0];
  const letters = document.createElement('span');
  letters.className = 'lang-menu-short';
  letters.textContent = info.short;
  menu.current.replaceChildren(flag(info.flag), letters);
  menu.button.setAttribute('aria-label', t('languageCurrent', { value: info.name }));
  menu.list.setAttribute('aria-label', t('language'));
  for (const [code, item] of menu.items) {
    item.setAttribute('aria-checked', String(code === language));
    const check = item.querySelector('.lang-menu-check');
    check?.replaceChildren(...(code === language ? [icon('check')] : []));
  }
}

/** Whether a language starts with a typed letter: its own name, its letters, its name here or in English. */
function startsWith(item: HTMLButtonElement, typed: string) {
  const code = item.dataset['lang'] ?? '';
  const info = LANGUAGES.find((language) => language.code === code);
  const words = [
    info?.name ?? '',
    info?.short ?? '',
    nameIn(code, currentLanguage()),
    nameIn(code, 'en'),
  ];
  return words.some((word) => word.toLocaleLowerCase().startsWith(typed));
}

/** Keys in the open list: arrows, Home and End move; a letter jumps; Escape and Tab close. */
function onListKey(menu: Menu, event: KeyboardEvent) {
  const buttons = [...menu.items.values()];
  const at = buttons.findIndex((item) => item === document.activeElement);
  const move = (to: number) => {
    event.preventDefault();
    buttons[(to + buttons.length) % buttons.length]?.focus();
  };
  if (event.key === 'ArrowDown') move(at + 1);
  else if (event.key === 'ArrowUp') move(at - 1);
  else if (event.key === 'Home') move(0);
  else if (event.key === 'End') move(buttons.length - 1);
  else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeList(menu);
  } else if (event.key === 'Tab') closeList(menu);
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const typed = event.key.toLocaleLowerCase();
    if (!typed.trim()) return;
    const next = [...buttons.slice(at + 1), ...buttons.slice(0, at + 1)].find((item) =>
      startsWith(item, typed),
    );
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
}

/**
 * The language of the console: a button with the current language's flag and letters, opening a
 * list of every language by its flag and its own name (the name a person who reads it looks for,
 * whatever the page is in now). The arrows, Home and End move in the list; a letter jumps to the
 * next language it starts (its own name, its letters, or its name here or in English: "g" finds
 * Deutsch); Enter or a click chooses; Escape or a click elsewhere closes it. The list is a popover
 * the button opens: above everything, clipped by nothing.
 */
export function installLanguageMenu() {
  const button = element('language', HTMLButtonElement);
  const list = element('language-list', HTMLElement);
  const current = element('language-current', HTMLElement);
  const menu: Menu = {
    button,
    list,
    current,
    items: buildItems(list, (code) => {
      void setLanguage(code).then(() => {
        closeList(menu);
      });
    }),
  };
  list.addEventListener('toggle', (event) => {
    const opened = event.newState === 'open';
    button.setAttribute('aria-expanded', String(opened));
    if (opened) list.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  });
  button.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !list.matches(':popover-open')) {
      event.preventDefault();
      try {
        list.showPopover();
      } catch {
        // Already shown.
      }
    }
  });
  list.addEventListener('keydown', (event) => {
    onListKey(menu, event);
  });
  onLanguageChange(() => {
    render(menu);
  });
  render(menu);
}

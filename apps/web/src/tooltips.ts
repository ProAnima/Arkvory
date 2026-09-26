import { isMessageKey } from './messages.js';
import { t } from './i18n.js';

type Help = { host: HTMLElement; trigger: HTMLButtonElement; tip: HTMLElement };

/** Optional explanations only: errors, deletion warnings and transfer state stay visible. */
export function initializeTooltips() {
  let active: Help | undefined;
  let pinned = false;
  const close = () => {
    if (active) active.tip.hidden = true;
    active = undefined;
    pinned = false;
  };
  const open = (help: Help) => {
    if (active !== help) close();
    active = help;
    const anchor = help.trigger.getBoundingClientRect();
    help.host.dataset['align'] = anchor.left > innerWidth / 2 ? 'end' : 'start';
    // Keep the explanation away from its trigger, including touch controls near screen edges.
    help.host.dataset['edge'] = anchor.top > innerHeight / 2 ? 'top' : 'bottom';
    help.tip.hidden = false;
  };
  document.querySelectorAll<HTMLElement>('[data-help]').forEach((tip, index) => {
    const label = tip.dataset['help'];
    if (!label || !isMessageKey(label)) return;
    const host = document.createElement('div');
    host.className = 'help-tooltip';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'help-trigger';
    trigger.dataset['i18nLabel'] = label;
    trigger.setAttribute('aria-label', t(label));
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '?';
    trigger.append(icon);
    // Reuse the translated text node; switching language must not rebuild forms.
    tip.replaceWith(host);
    tip.id ||= `context-help-${String(index)}`;
    tip.className = 'help-content';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    trigger.setAttribute('aria-describedby', tip.id);
    host.append(trigger, tip);
    const help = { host, trigger, tip };
    host.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') open(help);
    });
    host.addEventListener('pointerleave', () => {
      if (active === help && !pinned && document.activeElement !== trigger) close();
    });
    trigger.addEventListener('focus', () => {
      open(help);
    });
    trigger.addEventListener('click', () => {
      if (active === help && pinned) close();
      else {
        open(help);
        pinned = true;
      }
    });
    host.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !host.contains(event.relatedTarget)) {
        if (active === help) close();
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) {
      close();
      event.preventDefault();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (active && event.target instanceof Node && !active.host.contains(event.target)) close();
  });
  window.addEventListener('resize', close);
}

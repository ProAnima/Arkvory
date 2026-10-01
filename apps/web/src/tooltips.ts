import { isMessageKey } from './messages.js';
import { t } from './i18n.js';

type Help = { host: HTMLElement; trigger: HTMLButtonElement; tip: HTMLElement };
type Controller = {
  open(help: Help): void;
  close(): void;
  toggle(help: Help): void;
  is(help: Help): boolean;
  pinned(): boolean;
};

function controller(): Controller {
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
  return {
    open,
    close,
    is: (help) => active === help,
    pinned: () => pinned,
    toggle: (help) => {
      if (active === help && pinned) close();
      else {
        open(help);
        pinned = true;
      }
    },
  };
}

function trigger(label: Parameters<typeof t>[0], tipId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-trigger';
  button.dataset['i18nLabel'] = label;
  button.setAttribute('aria-label', t(label));
  button.setAttribute('aria-describedby', tipId);
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '?';
  button.append(icon);
  return button;
}

/** Optional explanations only: errors, deletion warnings and transfer state stay visible. */
export function initializeTooltips() {
  const state = controller();
  let counter = 0;
  const enhance = (tip: HTMLElement) => {
    const label = tip.dataset['help'];
    if (!label || !isMessageKey(label) || tip.dataset['helpReady']) return;
    tip.dataset['helpReady'] = 'true';
    const host = document.createElement('div');
    host.className = 'help-tooltip';
    tip.id ||= `context-help-${String(counter++)}`;
    const button = trigger(label, tip.id);
    // Reuse the translated text node; switching language must not rebuild forms.
    tip.replaceWith(host);
    tip.className = 'help-content';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    host.append(button, tip);
    const help = { host, trigger: button, tip };
    host.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') state.open(help);
    });
    host.addEventListener('pointerleave', () => {
      if (state.is(help) && !state.pinned() && document.activeElement !== button) state.close();
    });
    button.addEventListener('focus', () => {
      state.open(help);
    });
    button.addEventListener('click', () => {
      state.toggle(help);
    });
    host.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !host.contains(event.relatedTarget))
        if (state.is(help)) state.close();
    });
  };
  const scan = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>('[data-help]:not([data-help-ready])').forEach(enhance);
  };
  scan(document);
  // Controllers build some panels at runtime; their explanations become tooltips the same way.
  new MutationObserver((records) => {
    for (const record of records)
      for (const added of record.addedNodes)
        if (added instanceof HTMLElement) {
          if (added.matches('[data-help]')) enhance(added);
          scan(added);
        }
  }).observe(document.body, { childList: true, subtree: true });
}

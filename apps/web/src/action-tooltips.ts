function actionControl(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(
        '[data-icon-only], [data-navigation="compact"] [data-nav], .preferences select',
      )
    : null;
}

/** Observe only the active control and its ancestor chain, never the live data subtree. */
function watchControl(control: HTMLElement, close: () => void) {
  const label = control.getAttribute('aria-label');
  const observer = new MutationObserver(() => {
    if (
      !control.isConnected ||
      control.closest('[hidden]') ||
      control.matches(':disabled') ||
      control.getAttribute('aria-label') !== label
    )
      close();
  });
  for (let node: HTMLElement | null = control; node; node = node.parentElement)
    observer.observe(node, {
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'aria-label'],
    });
  return observer;
}

/** One top-layer tooltip serves dynamic controls without per-row listeners or inline positioning. */
export function initializeActionTooltips() {
  const tip = document.createElement('div');
  tip.id = 'action-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  if (typeof tip.showPopover !== 'function') return;
  document.body.append(tip);
  let active: HTMLElement | undefined;
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
  };
  const close = () => {
    cancel();
    observer?.disconnect();
    active?.removeAttribute('data-action-anchor');
    active = undefined;
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
  const show = (control: HTMLElement | null) => {
    if (!control || control.matches(':disabled')) return;
    const label = control.getAttribute('aria-label') ?? control.textContent.trim();
    if (!label) return;
    cancel();
    if (active === control) return;
    close();
    active = control;
    control.setAttribute('data-action-anchor', '');
    tip.dataset['side'] = control.closest('nav') ? 'rail' : 'action';
    tip.textContent = label;
    tip.showPopover();
    observer = watchControl(control, close);
  };
  const leave = () => {
    // Pointer movement must not dismiss help opened by keyboard focus.
    if (!active?.matches(':focus-visible')) close();
  };
  document.addEventListener('pointerover', (event) => {
    const control = actionControl(event.target);
    if (event.pointerType !== 'mouse' || !control) return;
    // SVG descendants bubble pointer events too; Escape stays dismissed inside the button.
    if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) return;
    show(control);
  });
  document.addEventListener('focusin', (event) => {
    show(actionControl(event.target));
  });
  document.addEventListener('pointerout', (event) => {
    if (!active || !(event.target instanceof Node) || !active.contains(event.target)) return;
    if (event.relatedTarget instanceof Node && active.contains(event.relatedTarget)) return;
    cancel();
    timer = setTimeout(leave, 150);
  });
  tip.addEventListener('pointerenter', cancel);
  tip.addEventListener('pointerleave', leave);
  document.addEventListener('focusout', close);
  document.addEventListener('pointerdown', close);
  document.addEventListener('click', close);
  document.addEventListener('change', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  document.addEventListener('visibilitychange', close);
}

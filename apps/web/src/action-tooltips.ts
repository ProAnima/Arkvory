/** One top-layer tooltip serves dynamic controls without per-row listeners or inline positioning. */
export function initializeActionTooltips() {
  const tip = document.createElement('div');
  tip.id = 'action-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  if (typeof tip.showPopover !== 'function') return;
  document.body.append(tip);
  let active: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
  };
  const close = () => {
    cancel();
    active?.removeAttribute('data-action-anchor');
    active = undefined;
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
  const show = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>(
      '[data-icon-only], [data-navigation="compact"] [data-nav], .preferences select',
    );
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
  };
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse') show(event.target);
  });
  document.addEventListener('focusin', (event) => {
    show(event.target);
  });
  document.addEventListener('pointerout', (event) => {
    if (!active || !(event.target instanceof Node) || !active.contains(event.target)) return;
    if (event.relatedTarget instanceof Node && active.contains(event.relatedTarget)) return;
    cancel();
    timer = setTimeout(close, 150);
  });
  tip.addEventListener('pointerenter', cancel);
  tip.addEventListener('pointerleave', close);
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

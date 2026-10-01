import { clearMessage } from './i18n.js';
import { showFailure } from './feedback.js';

/** One operation per panel; detached identities cannot update its DOM or unlock a newer task. */
export class ManagementTask {
  private controller = new AbortController();
  private busy = false;
  constructor(
    private readonly controls: HTMLFieldSetElement,
    readonly status: HTMLOutputElement,
  ) {}
  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    this.busy = false;
    this.controls.disabled = false;
    this.controls.removeAttribute('aria-busy');
    clearMessage(this.status);
  }
  run(action: (signal: AbortSignal) => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    const owner = this.controller.signal;
    const signal = AbortSignal.any([owner, AbortSignal.timeout(30_000)]);
    this.controls.disabled = true;
    this.controls.setAttribute('aria-busy', 'true');
    clearMessage(this.status);
    void action(signal)
      .catch((error: unknown) => {
        if (!owner.aborted) showFailure(this.status, error);
      })
      .finally(() => {
        if (owner.aborted) return;
        this.busy = false;
        this.controls.disabled = false;
        this.controls.removeAttribute('aria-busy');
      });
  }
}

export function requestCurrent(signal: AbortSignal): boolean {
  return !signal.aborted;
}

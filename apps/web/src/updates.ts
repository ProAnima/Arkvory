import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { UpdateSnapshot, UpdateRequest } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { showView } from './shell.js';
import { UpdateView } from './update-view.js';
import type { MessageKey } from './messages.js';
import { errorKey, showFailure } from './feedback.js';

class UpdateConsole {
  private readonly view = new UpdateView();
  private snapshot: UpdateSnapshot | null = null;
  private selected: UpdateSnapshot['latest'] = null;
  private generation = 0;
  private active = false;
  private dirty = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly client: ArkvoryClient) {
    const v = this.view;
    v.form.addEventListener('input', () => {
      this.dirty = true;
    });
    v.check.onclick = () => {
      if (this.snapshot && !this.busy)
        void this.send({
          id: crypto.randomUUID(),
          kind: 'check',
          expectedRevision: this.snapshot.revision,
        });
    };
    v.form.onsubmit = (event) => {
      event.preventDefault();
      if (this.snapshot && !this.busy)
        void this.send({
          id: crypto.randomUUID(),
          kind: 'configure',
          expectedRevision: this.snapshot.revision,
          automatic: v.automatic.checked,
          hourUTC: Number(v.hour.value),
          ...(this.snapshot.statistics === undefined ? {} : { statistics: v.statistics.checked }),
        });
    };
    v.install.onclick = () => {
      this.selected = this.snapshot?.latest ?? null;
      if (this.selected) {
        message(element('update-confirm-title', HTMLElement), 'updateConfirm', {
          version: this.selected.version,
        });
        v.dialog.showModal();
      }
    };
    element('update-cancel', HTMLButtonElement).onclick = () => {
      v.dialog.close();
    };
    element('update-proceed', HTMLButtonElement).onclick = () => {
      v.dialog.close();
      if (this.snapshot && this.selected && !this.busy)
        void this.send({
          id: crypto.randomUUID(),
          kind: 'apply',
          expectedRevision: this.snapshot.revision,
          version: this.selected.version,
          sha256: this.selected.sha256,
        });
    };
  }
  private async refresh() {
    const current = this.generation;
    try {
      const data = await this.client.updates.status();
      if (current !== this.generation || !this.active) return;
      this.snapshot = data.snapshot;
      this.view.render(data.snapshot, !!data.pending || this.busy, this.dirty);
    } catch {
      if (current === this.generation && this.active) {
        message(this.view.output, 'updateConnection');
        this.view.disable();
      }
    }
  }
  private async poll(generation: number) {
    await this.refresh();
    // A completed request from a previous account must not create a second polling loop.
    if (this.active && generation === this.generation)
      this.timer = setTimeout(() => {
        void this.poll(generation);
      }, 30000);
  }
  private async send(request: UpdateRequest) {
    const generation = this.generation;
    let failure: { key: MessageKey; error: unknown } | undefined;
    this.busy = true;
    this.view.disable();
    try {
      await this.client.updates.request(request);
      if (generation !== this.generation) return;
      this.dirty = false;
      message(this.view.output, 'updatePending');
    } catch (error) {
      const key =
        error instanceof ArkvoryHttpError
          ? error.status === 409
            ? 'updateConflict'
            : errorKey(error)
          : 'updateConnection';
      failure = { key, error };
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        await this.refresh();
        // Reconciliation must not erase why the requested action was refused.
        if (failure && generation === this.generation)
          showFailure(this.view.output, failure.error, failure.key);
      }
    }
  }
  clear() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
    this.snapshot = null;
    this.selected = null;
    this.dirty = false;
    this.busy = false;
    this.view.nav.hidden = true;
    this.view.banner.hidden = true;
    clearMessage(this.view.output);
    this.view.clear();
    this.view.dialog.close();
    if (!element('updates-panel', HTMLElement).hidden) showView('catalog');
  }
  connect(administrator: boolean) {
    this.clear();
    if (administrator) {
      this.active = true;
      this.view.nav.hidden = false;
      void this.poll(this.generation);
    }
  }
}
export function installUpdates(client: ArkvoryClient) {
  return new UpdateConsole(client);
}

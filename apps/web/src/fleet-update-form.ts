import type { UpdateRequest, UpdateSnapshot } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';
import { feedback, showFailure } from './feedback.js';
import { confirmAction } from './confirm-dialog.js';

/** The updater of this installation or of a managed site through it (ADR 0038, ADR 0077). */
export interface UpdatesPort {
  status(): Promise<{ snapshot: UpdateSnapshot | null; pending: UpdateRequest | null }>;
  request(request: UpdateRequest): Promise<{ id: string }>;
}

/**
 * The update settings of a site: maintenance hour and automatic installation, a check now and
 * the installation of the release it found. Requests go to the site's updater mailbox; the site
 * applies them within a minute, so the form shows the request as accepted, not as done.
 */
export class UpdateSettingsForm {
  private readonly form = element('fleet-update-form', HTMLFormElement);
  private readonly automatic = element('fleet-update-automatic', HTMLInputElement);
  private readonly hour = element('fleet-update-hour', HTMLSelectElement);
  private readonly status = element('fleet-update-status', HTMLOutputElement);
  private readonly install = element('fleet-update-install', HTMLButtonElement);
  private port: UpdatesPort | null = null;
  private snapshot: UpdateSnapshot | null = null;
  private generation = 0;

  constructor() {
    for (let hour = 0; hour < 24; hour++)
      this.hour.append(new Option(`${String(hour).padStart(2, '0')}:00`, String(hour)));
    this.form.onsubmit = (event) => {
      event.preventDefault();
      const snapshot = this.snapshot;
      if (!snapshot) return;
      void this.send({
        id: crypto.randomUUID(),
        kind: 'configure',
        expectedRevision: snapshot.revision,
        automatic: this.automatic.checked,
        hourUTC: Number(this.hour.value),
        ...(snapshot.statistics === undefined ? {} : { statistics: snapshot.statistics }),
      });
    };
    element('fleet-update-check', HTMLButtonElement).onclick = () => {
      if (this.snapshot)
        void this.send({
          id: crypto.randomUUID(),
          kind: 'check',
          expectedRevision: this.snapshot.revision,
        });
    };
    this.install.onclick = () => {
      void this.installLatest();
    };
  }

  async open(port: UpdatesPort) {
    this.port = port;
    this.status.hidden = true;
    const generation = ++this.generation;
    try {
      const answer = await port.status();
      if (generation === this.generation) this.show(answer.snapshot, answer.pending !== null);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  clear() {
    this.generation++;
    this.port = null;
    this.snapshot = null;
    this.status.hidden = true;
  }

  private show(snapshot: UpdateSnapshot | null, pending: boolean) {
    this.snapshot = snapshot;
    const connected = snapshot !== null;
    for (const control of this.form.elements)
      if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement)
        control.disabled = !connected || pending;
    this.hour.disabled = !connected || pending;
    element('fleet-update-current', HTMLElement).textContent = snapshot?.currentVersion ?? '—';
    element('fleet-update-latest', HTMLElement).textContent = snapshot?.latest?.version ?? '—';
    const checked = element('fleet-update-checked', HTMLElement);
    if (snapshot?.checkedAt) relativeMessage(checked, snapshot.checkedAt);
    else message(checked, 'updateUnknown');
    this.install.hidden = !snapshot?.latest || snapshot.latest.version === snapshot.currentVersion;
    if (!snapshot) {
      this.status.hidden = false;
      feedback(this.status, 'updateUnavailable', {}, 'error');
      return;
    }
    this.automatic.checked = snapshot.automatic;
    this.hour.value = String(snapshot.hourUTC);
    if (pending) {
      this.status.hidden = false;
      feedback(this.status, 'updatePending', {}, 'info');
    }
  }

  private async installLatest() {
    const latest = this.snapshot?.latest;
    const snapshot = this.snapshot;
    if (!latest || !snapshot) return;
    if (!(await confirmAction('updateConfirm', { version: latest.version }, 'updateConfirmButton')))
      return;
    await this.send({
      id: crypto.randomUUID(),
      kind: 'apply',
      expectedRevision: snapshot.revision,
      version: latest.version,
      sha256: latest.sha256,
    });
  }

  private async send(request: UpdateRequest) {
    const port = this.port;
    if (!port) return;
    const generation = this.generation;
    try {
      await port.request(request);
      if (generation !== this.generation) return;
      await this.open(port);
      this.status.hidden = false;
      feedback(this.status, 'updatePending', {}, 'success');
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  private fail(error: unknown) {
    this.status.hidden = false;
    showFailure(this.status, error);
  }
}

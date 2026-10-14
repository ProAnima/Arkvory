import type { SiteMirror } from '@proanima/arkvory-contracts';
import { readSiteChange } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';
import { feedback } from './feedback.js';
import { confirmAction } from './confirm-dialog.js';
import type { Submit } from './fleet-agent-port.js';

const cell = (text: string) => {
  const td = document.createElement('td');
  // Names and addresses come from the site: text, never markup.
  td.textContent = text;
  return td;
};

/**
 * Mirrors and imports of a site (ADR 0058) changed through its agent: attach one with its source
 * key, replace a key, detach. The key goes once, in its own field of the request; the form forgets
 * it as soon as the request is sent.
 */
export class MirrorChanges {
  private readonly rows = element('fleet-mirror-rows', HTMLTableSectionElement);
  private readonly form = element('fleet-mirror-form', HTMLFormElement);
  private readonly keyForm = element('fleet-mirror-key-form', HTMLFormElement);
  private readonly status = element('fleet-agent-status', HTMLOutputElement);
  private keyFor: string | null = null;

  constructor(private readonly submit: Submit) {
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.attach();
    };
    this.keyForm.onsubmit = (event) => {
      event.preventDefault();
      void this.replaceKey();
    };
    element('fleet-mirror-key-cancel', HTMLButtonElement).onclick = () => {
      this.closeKey();
    };
  }

  show(mirrors: readonly SiteMirror[]) {
    element('fleet-mirror-empty', HTMLElement).hidden = mirrors.length > 0;
    this.rows.replaceChildren(...mirrors.map((mirror) => this.row(mirror)));
  }

  clear() {
    this.rows.replaceChildren();
    this.form.reset();
    this.closeKey();
  }

  private row(mirror: SiteMirror) {
    const row = document.createElement('tr');
    const actions = document.createElement('td');
    const buttons = document.createElement('div');
    buttons.className = 'button-row compact';
    const key = this.button('fleetMirrorKeySave', () => {
      this.keyFor = mirror.repository;
      message(element('fleet-mirror-key-title', HTMLElement), 'fleetMirrorKeyFor', {
        repository: mirror.repository,
      });
      this.keyForm.hidden = false;
      element('fleet-mirror-key', HTMLInputElement).focus();
    });
    const detach = this.button('fleetMirrorDetach', async () => {
      const confirmed = await confirmAction(
        'fleetMirrorDetachConfirm',
        { repository: mirror.repository },
        'fleetMirrorDetach',
      );
      if (confirmed)
        await this.submit({ kind: 'mirror-detach', repositories: [mirror.repository] });
    });
    buttons.append(key, detach);
    actions.append(buttons);
    const phase = document.createElement('td');
    const mode = document.createElement('div');
    message(mode, mirror.mode === 'import' ? 'fleetMirrorImport' : 'fleetMirrorMirror');
    // The phase and error code are the site's own words, shown as they are.
    const state = document.createElement('div');
    state.className = 'hint';
    state.textContent = mirror.phase;
    phase.append(mode, state);
    if (mirror.errorCode) {
      const error = document.createElement('div');
      error.className = 'hint';
      error.textContent = mirror.errorCode;
      phase.append(error);
    }
    row.append(
      cell(mirror.repository),
      cell(`${mirror.upstream} / ${mirror.sourceRepository}`),
      phase,
      actions,
    );
    return row;
  }

  private button(key: 'fleetMirrorKeySave' | 'fleetMirrorDetach', run: () => unknown) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    message(button, key);
    button.onclick = () => void run();
    return button;
  }

  private async attach() {
    const value = (id: string) => element(id, HTMLInputElement).value.trim();
    const stages = value('fleet-mirror-stages');
    const certificate = element('fleet-mirror-certificate', HTMLTextAreaElement).value.trim();
    const key = element('fleet-mirror-new-key', HTMLInputElement);
    let change;
    try {
      change = readSiteChange({
        kind: 'mirror-attach',
        repository: value('fleet-mirror-repository'),
        upstream: value('fleet-mirror-upstream'),
        sourceRepository: value('fleet-mirror-source') || value('fleet-mirror-repository'),
        stages: stages ? stages.split(',').map((stage) => stage.trim()) : null,
        certificate: certificate || null,
      });
    } catch {
      this.status.hidden = false;
      feedback(this.status, 'fleetMirrorInvalid', {}, 'error');
      return;
    }
    const secret = key.value.trim();
    // The key leaves the page with this request and is not kept in the form.
    key.value = '';
    if (await this.submit(change, secret)) this.form.reset();
  }

  private async replaceKey() {
    const input = element('fleet-mirror-key', HTMLInputElement);
    const secret = input.value.trim();
    input.value = '';
    if (this.keyFor === null) return;
    if (await this.submit({ kind: 'mirror-key', repository: this.keyFor }, secret)) this.closeKey();
  }

  private closeKey() {
    this.keyFor = null;
    element('fleet-mirror-key', HTMLInputElement).value = '';
    this.keyForm.hidden = true;
  }
}

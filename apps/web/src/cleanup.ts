import type { DepotClient } from '@proanima/depot-sdk';
import { readCleanupPolicy } from '@proanima/depot-contracts';
import { element } from './dom.js';
import { message, dateMessage } from './i18n.js';
import { feedback, errorKey } from './feedback.js';

export function installCleanup(client: DepotClient) {
  return new CleanupPanel(client);
}
class CleanupPanel {
  private readonly panel = element('cleanup-panel', HTMLDetailsElement);
  private readonly form = element('cleanup-form', HTMLFormElement);
  private readonly fields = element('cleanup-fields', HTMLFieldSetElement);
  private readonly output = element('cleanup-status', HTMLOutputElement);
  private readonly run = element('cleanup-run', HTMLButtonElement);
  private readonly refresh = element('cleanup-refresh', HTMLButtonElement);
  private repository = '';
  private generation = 0;
  private controller = new AbortController();
  private revision: number | undefined;
  private manage = false;
  private enabled = false;
  private busy = false;
  constructor(private readonly client: DepotClient) {
    this.refresh.onclick = () => {
      void this.perform('load');
    };
    this.run.onclick = () => {
      void this.perform('run');
    };
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.perform('save');
    };
    this.panel.ontoggle = () => {
      if (this.panel.open && this.revision === undefined) void this.perform('load');
    };
  }
  private input(name: string) {
    return element('cleanup-' + name, HTMLInputElement);
  }
  private controls() {
    this.fields.disabled = this.busy || !this.manage || this.revision === undefined;
    this.run.disabled = this.busy || !this.manage || !this.enabled || this.revision === undefined;
    this.refresh.disabled = this.busy;
    this.run.hidden = !this.manage;
    element('cleanup-save', HTMLButtonElement).hidden = !this.manage;
  }
  clear() {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.repository = '';
    this.revision = undefined;
    this.manage = false;
    this.busy = false;
    this.enabled = false;
    this.panel.hidden = true;
    this.panel.open = false;
    this.form.reset();
    for (const id of [
      'cleanup-status',
      'cleanup-stats',
      'cleanup-last',
      'cleanup-state',
      'cleanup-error',
    ]) {
      const node = document.getElementById(id);
      if (node) {
        node.textContent = '';
        for (const attribute of Array.from(node.attributes))
          if (attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
      }
    }
    this.controls();
  }
  async connect(repository: string) {
    if (repository === this.repository) return;
    this.clear();
    this.repository = repository;
    const generation = this.generation;
    try {
      const permissions = await this.client.permissions(this.controller.signal);
      if (generation !== this.generation) return;
      const actions = new Set(
        permissions.bindings.filter((b) => b.resource.id === repository).flatMap((b) => b.actions),
      );
      this.manage = actions.has('storage.manage');
      this.panel.hidden = !actions.has('storage.read');
      this.controls();
    } catch {
      if (generation === this.generation) this.panel.hidden = true;
    }
  }
  private async perform(action: 'load' | 'save' | 'run') {
    if (this.busy || !this.repository) return;
    const generation = this.generation,
      repository = this.repository,
      signal = this.controller.signal;
    this.busy = true;
    this.controls();
    try {
      const scope = this.client.inRepository(repository).storage;
      let state;
      if (action === 'save' && this.revision !== undefined) {
        const policy = readCleanupPolicy({
          enabled: this.input('enabled').checked,
          graceHours: this.input('grace').valueAsNumber,
          batchSize: this.input('batch').valueAsNumber,
          intervalSeconds: this.input('interval').valueAsNumber,
          delayMilliseconds: this.input('delay').valueAsNumber,
        });
        state = await scope.configureCleanup(this.revision, policy, signal);
      } else if (action === 'run' && this.revision !== undefined)
        state = await scope.requestCleanup(this.revision, signal);
      else state = await scope.cleanup(signal);
      if (generation !== this.generation) return;
      this.revision = state.revision;
      this.enabled = state.policy.enabled;
      this.input('enabled').checked = state.policy.enabled;
      for (const [id, value] of [
        ['grace', state.policy.graceHours],
        ['batch', state.policy.batchSize],
        ['interval', state.policy.intervalSeconds],
        ['delay', state.policy.delayMilliseconds],
      ] as const)
        this.input(id).value = String(value);
      message(
        element('cleanup-state', HTMLParagraphElement),
        state.policy.enabled ? 'cleanupScheduled' : 'cleanupPaused',
      );
      message(element('cleanup-stats', HTMLParagraphElement), 'cleanupStats', {
        bytes: state.lastReclaimedBytes,
        collected: state.lastCollected,
        deferred: state.lastDeferred,
        failed: state.lastFailed,
      });
      const last = element('cleanup-last', HTMLSpanElement);
      if (state.lastRunAt) dateMessage(last, state.lastRunAt);
      else last.textContent = '—';
      element('cleanup-error', HTMLParagraphElement).textContent = state.lastError ?? '';
      if (action !== 'load')
        feedback(
          this.output,
          action === 'run' ? 'cleanupRequested' : 'cleanupSaved',
          {},
          'success',
        );
    } catch (error) {
      if (generation === this.generation) feedback(this.output, errorKey(error), {}, 'error');
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.controls();
      }
    }
  }
}

import { element } from './dom.js';
import { message } from './i18n.js';
import { QueueSettingsForm, type QueueSettingsPort } from './fleet-queue-form.js';
import { UpdateSettingsForm, type UpdatesPort } from './fleet-update-form.js';
import { AgentPanel, type AgentTarget } from './fleet-agent.js';

/** What a site's settings are changed through: this installation's API or a managed site's. */
export interface SettingsTarget extends AgentTarget {
  readonly id: string;
  readonly name: string;
  readonly downloadSettings: QueueSettingsPort;
  readonly updates: UpdatesPort;
}

/**
 * The settings of one site (ADR 0077, stage F3), the same card for this site and for a site it
 * manages: the download queue, the updater, and mirrors and HA through the site's agent.
 */
export class FleetSettings {
  private readonly card = element('fleet-settings', HTMLElement);
  private readonly queue = new QueueSettingsForm();
  private readonly updates = new UpdateSettingsForm();
  private readonly agent = new AgentPanel();
  /** The site shown, so removing it from the list closes its settings. */
  current: string | null = null;

  constructor() {
    element('fleet-settings-close', HTMLButtonElement).onclick = () => {
      this.clear();
    };
  }

  async open(target: SettingsTarget) {
    this.clear();
    this.current = target.id;
    message(element('fleet-settings-title', HTMLElement), 'fleetSettingsOf', {
      name: target.name,
    });
    this.card.hidden = false;
    this.card.scrollIntoView({ block: 'nearest' });
    await Promise.all([
      this.queue.open(target.downloadSettings),
      this.updates.open(target.updates),
      this.agent.open(target),
    ]);
  }

  clear() {
    this.current = null;
    this.card.hidden = true;
    this.queue.clear();
    this.updates.clear();
    this.agent.clear();
  }
}

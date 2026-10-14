import { element } from './dom.js';
import { message } from './i18n.js';
import { QueueSettingsForm, type QueueSettingsPort } from './fleet-queue-form.js';
import { UpdateSettingsForm, type UpdatesPort } from './fleet-update-form.js';

/** What a site's settings are changed through: this installation's API or a managed site's. */
export interface SettingsTarget {
  readonly id: string;
  readonly name: string;
  readonly downloadSettings: QueueSettingsPort;
  readonly updates: UpdatesPort;
}

/**
 * The settings of one site (ADR 0077, stage F3), the same card for this site and for a site it
 * manages: the download queue and the updater. Mirrors and HA follow in later stages.
 */
export class FleetSettings {
  private readonly card = element('fleet-settings', HTMLElement);
  private readonly queue = new QueueSettingsForm();
  private readonly updates = new UpdateSettingsForm();
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
    ]);
  }

  clear() {
    this.current = null;
    this.card.hidden = true;
    this.queue.clear();
    this.updates.clear();
  }
}

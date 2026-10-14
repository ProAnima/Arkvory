import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { FleetSite } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message, relativeMessage, t } from './i18n.js';
import { onViewOpen } from './shell.js';
import { feedback, showFailure } from './feedback.js';
import { confirmAction } from './confirm-dialog.js';
import {
  copiesLine,
  gatewaysLine,
  hintKeys,
  mirrorsLine,
  queueLine,
  roleKeys,
  stateKeys,
  type Line,
} from './fleet-presentation.js';
import { FleetPairingCard } from './fleet-pairing.js';
import { FleetContent } from './fleet-content.js';
import { FleetSettings } from './fleet-settings.js';
import { FleetOverviewPanel } from './fleet-overview-panel.js';

/** While the page is open it follows the background reads of the server. */
const REFRESH_MS = 30000;

/** The nodes of one row, updated in place: focus and a text selection survive a refresh. */
interface Row {
  readonly row: HTMLTableRowElement;
  readonly name: HTMLElement;
  readonly url: HTMLElement;
  readonly badge: HTMLElement;
  readonly hint: HTMLElement;
  readonly version: HTMLElement;
  readonly role: HTMLElement;
  readonly copies: HTMLElement;
  readonly gateways: HTMLElement;
  readonly mirrors: HTMLElement;
  readonly queue: HTMLElement;
  readonly seen: HTMLElement;
}

const node = (tag: string, className = '') => {
  const created = document.createElement(tag);
  if (className) created.className = className;
  return created;
};
const cell = (...children: Node[]) => {
  const td = document.createElement('td');
  td.append(...children);
  return td;
};
const show = (target: HTMLElement, line: Line | null) => {
  target.hidden = line === null;
  if (line) message(target, line.key, line.params);
  else clearMessage(target);
};

/**
 * The Sites page (ADR 0077): the sites this installation manages with what each last reported,
 * pairing a new one, and who manages this site. Global administrators only.
 */
export class FleetPage {
  private readonly nav = element('fleet-nav', HTMLButtonElement);
  private readonly panel = element('fleet-panel', HTMLElement);
  private readonly rows = element('fleet-rows', HTMLTableSectionElement);
  private readonly status = element('fleet-status', HTMLOutputElement);
  private readonly shown = new Map<string, Row>();
  private readonly pairing: FleetPairingCard;
  private readonly content: FleetContent;
  private readonly settings = new FleetSettings();
  private readonly overview = new FleetOverviewPanel();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly client: ArkvoryClient) {
    this.content = new FleetContent(client);
    this.pairing = new FleetPairingCard(client, () => this.refresh(this.generation));
    onViewOpen('fleet', () => {
      void this.refresh(this.generation);
      void this.pairing.open();
    });
    // This site's own settings, through its own API: the same card as for a managed site.
    element('fleet-self-settings', HTMLButtonElement).onclick = () => {
      void this.settings.open({
        id: '',
        name: t('fleetThisSite'),
        downloadSettings: client.downloadSettings,
        updates: client.updates,
        changes: client.siteChanges,
        topology: () => client.fleet.topology(),
      });
    };
    element('fleet-read-all', HTMLButtonElement).onclick = () => {
      void this.readAll();
    };
  }

  connect(administrator: boolean) {
    this.clear();
    this.nav.hidden = !administrator;
    if (administrator) this.schedule(this.generation);
  }

  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.nav.hidden = true;
    this.shown.clear();
    this.rows.replaceChildren();
    this.pairing.clear();
    this.content.clear();
    this.settings.clear();
    this.overview.clear();
  }

  private schedule(generation: number) {
    this.timer = setTimeout(() => {
      const next = this.panel.hidden ? Promise.resolve() : this.refresh(generation);
      void next.then(() => {
        if (generation === this.generation) this.schedule(generation);
      });
    }, REFRESH_MS);
  }

  private async refresh(generation: number) {
    try {
      // The overview is built from the same reads; a failure of it never hides the list.
      const [sites, overview] = await Promise.all([
        this.client.fleet.sites(),
        this.client.fleet.overview().catch(() => null),
      ]);
      if (generation !== this.generation) return;
      this.status.hidden = true;
      this.render(sites);
      if (overview) this.overview.show(overview, sites);
      else this.overview.clear();
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.hidden = false;
      showFailure(this.status, error);
    }
  }

  /** Reads every site now, one after another, then shows the list. */
  private async readAll() {
    const generation = this.generation;
    const button = element('fleet-read-all', HTMLButtonElement);
    button.disabled = true;
    try {
      for (const id of [...this.shown.keys()]) await this.client.fleet.refresh(id);
      await this.refresh(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.status.hidden = false;
        showFailure(this.status, error);
      }
    } finally {
      button.disabled = false;
    }
  }

  private render(sites: readonly FleetSite[]) {
    element('fleet-empty', HTMLElement).hidden = sites.length > 0;
    element('fleet-table', HTMLElement).hidden = sites.length === 0;
    const present = new Set(sites.map((site) => site.id));
    for (const [id, row] of this.shown)
      if (!present.has(id)) {
        row.row.remove();
        this.shown.delete(id);
      }
    sites.forEach((site, index) => {
      const row = this.shown.get(site.id) ?? this.create(site);
      this.update(row, site);
      if (this.rows.rows[index] !== row.row)
        this.rows.insertBefore(row.row, this.rows.rows[index] ?? null);
    });
  }

  private create(site: FleetSite): Row {
    const name = node('strong');
    const url = node('div', 'hint fleet-url');
    const badge = node('span', 'badge fleet-badge');
    const hint = node('div', 'hint');
    const version = node('span');
    const role = node('div', 'hint');
    const copies = node('div');
    const gateways = node('div', 'hint');
    const mirrors = node('span');
    const queue = node('span');
    const seen = node('span');
    const browse = this.action('fleetContent', () => this.content.open(site.id, name.textContent));
    const configure = this.action('fleetSettings', () => {
      const remote = this.client.fleet.site(site.id);
      return this.settings.open({
        id: site.id,
        name: name.textContent,
        downloadSettings: remote.downloadSettings,
        updates: remote.updates,
        changes: remote.changes,
        // Read now, not the last poll: a change just applied must show.
        topology: () => this.client.fleet.refresh(site.id).then((read) => read.topology),
      });
    });
    const read = this.action('fleetReadSite', async () => {
      await this.client.fleet.refresh(site.id);
      await this.refresh(this.generation);
    });
    const remove = this.action('fleetRemoveSite', async () => {
      if (
        !(await confirmAction('fleetRemoveConfirm', { name: name.textContent }, 'fleetRemoveSite'))
      )
        return;
      await this.client.fleet.remove(site.id);
      if (this.content.current === site.id) this.content.clear();
      if (this.settings.current === site.id) this.settings.clear();
      feedback(this.status, 'fleetRemoved', {}, 'success');
      this.status.hidden = false;
      await this.refresh(this.generation);
    });
    const actions = node('div', 'button-row compact');
    actions.append(browse, configure, read, remove);
    const row = document.createElement('tr');
    row.append(
      cell(name, url),
      cell(badge, hint),
      cell(version, role),
      cell(copies, gateways),
      cell(mirrors),
      cell(queue),
      cell(seen),
      cell(actions),
    );
    const created = {
      row,
      name,
      url,
      badge,
      hint,
      version,
      role,
      copies,
      gateways,
      mirrors,
      queue,
      seen,
    };
    this.shown.set(site.id, created);
    return created;
  }

  private action(
    key: 'fleetContent' | 'fleetSettings' | 'fleetReadSite' | 'fleetRemoveSite',
    run: () => Promise<void>,
  ) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    message(button, key);
    button.onclick = async () => {
      button.disabled = true;
      try {
        await run();
      } catch (error) {
        this.status.hidden = false;
        showFailure(this.status, error);
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }

  private update(row: Row, site: FleetSite) {
    // Names and addresses are data: text, never markup.
    row.name.textContent = site.name;
    row.url.textContent = site.url;
    message(row.badge, stateKeys[site.state]);
    row.badge.dataset['state'] = site.state;
    show(
      row.hint,
      hintKeys[site.state] ? { key: hintKeys[site.state] ?? 'fleetHintInvalid', params: {} } : null,
    );
    const topology = site.topology;
    row.version.textContent = topology?.site.version ?? '—';
    show(row.role, topology ? { key: roleKeys[topology.site.role], params: {} } : null);
    show(row.copies, topology ? copiesLine(topology) : null);
    show(row.gateways, topology ? gatewaysLine(topology) : null);
    show(row.mirrors, topology ? mirrorsLine(topology) : null);
    show(row.queue, topology ? queueLine(topology) : null);
    if (site.seenAt) relativeMessage(row.seen, site.seenAt);
    else {
      clearMessage(row.seen);
      message(row.seen, 'fleetNever');
    }
  }
}

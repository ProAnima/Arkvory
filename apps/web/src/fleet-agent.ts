import type { SiteChange, SiteTopology } from '@proanima/arkvory-contracts';
import type { SiteChanges } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';
import { feedback, showFailure } from './feedback.js';
import type { MessageKey } from './messages.js';
import { MirrorChanges } from './fleet-mirror-changes.js';
import { ClusterChanges } from './fleet-cluster-changes.js';
import type { Submit } from './fleet-agent-port.js';

/** The agent mailbox of a site: this installation's or a managed site's through it. */
export interface ChangesPort {
  status(): Promise<SiteChanges>;
  request(request: { id: string; change: SiteChange; key?: string }): Promise<{ id: string }>;
}
export interface AgentTarget {
  readonly changes: ChangesPort;
  /** The site's state now: its mirrors and HA nodes. */
  readonly topology: () => Promise<SiteTopology | null>;
}

const kinds: Record<SiteChange['kind'], MessageKey> = {
  'mirror-attach': 'fleetKindAttach',
  'mirror-key': 'fleetKindKey',
  'mirror-detach': 'fleetKindDetach',
  'cluster-switchover': 'fleetKindSwitchover',
  'single-copy': 'fleetKindSingleCopy',
};
const states: Record<SiteChanges['recent'][number]['state'], MessageKey> = {
  pending: 'fleetChangePending',
  applying: 'fleetChangeApplying',
  done: 'fleetChangeDone',
  failed: 'fleetChangeFailed',
};
/** The agent takes a request within a minute; the panel looks a little more often. */
const FOLLOW_MS = 5000;

const cell = (text: string) => {
  const td = document.createElement('td');
  // Actors, reasons and names come from the site: text, never markup.
  td.textContent = text;
  return td;
};

/**
 * Mirrors and HA of a site through its agent (ADR 0077, stage F3). Requests are queued, not
 * applied: the panel shows them as the agent reports, and follows a pending one until it ends.
 */
export class AgentPanel {
  private readonly status = element('fleet-agent-status', HTMLOutputElement);
  private readonly rows = element('fleet-change-rows', HTMLTableSectionElement);
  private readonly mirrors: MirrorChanges;
  private readonly cluster: ClusterChanges;
  private target: AgentTarget | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const submit: Submit = (change, key) => this.submit(change, key);
    this.mirrors = new MirrorChanges(submit);
    this.cluster = new ClusterChanges(submit);
  }

  async open(target: AgentTarget) {
    this.clear();
    this.target = target;
    await this.refresh(this.generation, true);
  }

  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.target = null;
    this.rows.replaceChildren();
    this.status.hidden = true;
    this.mirrors.clear();
    this.cluster.clear();
    element('fleet-agent-missing', HTMLElement).hidden = true;
  }

  private async submit(change: SiteChange, key?: string): Promise<boolean> {
    const target = this.target;
    if (!target) return false;
    const generation = this.generation;
    try {
      await target.changes.request({
        id: crypto.randomUUID(),
        change,
        ...(key === undefined ? {} : { key }),
      });
      if (generation !== this.generation) return false;
      this.status.hidden = false;
      feedback(this.status, 'fleetChangeQueued', {}, 'success');
      await this.refresh(generation, false);
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.status.hidden = false;
        showFailure(this.status, error);
      }
      return false;
    }
  }

  private async refresh(generation: number, topology: boolean) {
    const target = this.target;
    if (!target) return;
    try {
      const [changes, state] = await Promise.all([
        target.changes.status(),
        topology ? target.topology() : Promise.resolve(undefined),
      ]);
      if (generation !== this.generation) return;
      element('fleet-agent-missing', HTMLElement).hidden = changes.agent;
      this.render(changes);
      if (state !== undefined) {
        this.mirrors.show(state?.mirrors ?? []);
        this.cluster.show(state?.replication ?? null);
      }
      // A pending or running request is followed until the agent reports how it ended; then
      // the site's state is read again, as a change moved it.
      const busy =
        changes.pending !== null || changes.recent.some((item) => item.state === 'applying');
      if (busy || !topology)
        this.timer = setTimeout(() => void this.refresh(generation, !busy), FOLLOW_MS);
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.hidden = false;
      showFailure(this.status, error);
    }
  }

  private render(changes: SiteChanges) {
    const rows = [
      ...(changes.pending ? [{ ...changes.pending, state: 'pending' as const, error: null }] : []),
      ...changes.recent,
    ].map((item) => {
      const row = document.createElement('tr');
      const kind = document.createElement('td');
      message(kind, kinds[item.kind]);
      const state = document.createElement('td');
      message(state, states[item.state]);
      if (item.error) state.append(document.createElement('br'), item.error);
      const when = document.createElement('td');
      relativeMessage(when, item.requestedAt);
      row.append(kind, state, cell(item.actor), when);
      return row;
    });
    this.rows.replaceChildren(...rows);
  }
}

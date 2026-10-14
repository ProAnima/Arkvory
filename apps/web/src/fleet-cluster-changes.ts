import type { SiteReplication } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback } from './feedback.js';
import { confirmAction } from './confirm-dialog.js';
import type { Submit } from './fleet-agent-port.js';

/**
 * HA of a site (ADR 0072) through its agent: a switchover to a node with a complete copy, and the
 * single-copy decision after a loss. A switchover needs the node name typed again, and the agent
 * checks it once more against the cluster; fencing and node changes stay local commands.
 */
export class ClusterChanges {
  private readonly box = element('fleet-cluster', HTMLElement);
  private readonly node = element('fleet-switchover-node', HTMLSelectElement);
  private readonly confirm = element('fleet-switchover-confirm', HTMLInputElement);
  private readonly status = element('fleet-agent-status', HTMLOutputElement);

  constructor(private readonly submit: Submit) {
    element('fleet-switchover-form', HTMLFormElement).onsubmit = (event) => {
      event.preventDefault();
      void this.switchover();
    };
    element('fleet-single-form', HTMLFormElement).onsubmit = (event) => {
      event.preventDefault();
      void this.singleCopy();
    };
    element('fleet-single-off', HTMLButtonElement).onclick = () => {
      void this.withdraw();
    };
  }

  show(replication: SiteReplication | null) {
    this.box.hidden = replication === null;
    if (!replication) return;
    message(element('fleet-cluster-state', HTMLElement), 'fleetClusterState', {
      node: replication.node ?? '—',
      copies: replication.copies,
      required: replication.required,
    });
    // Only a node holding a complete copy can take over without losing a write.
    const targets = (replication.peers ?? []).filter((peer) => peer.complete && !peer.witness);
    this.node.replaceChildren(...targets.map((peer) => new Option(peer.name, peer.name)));
    element('fleet-switchover-form', HTMLFormElement).hidden = targets.length === 0;
  }

  clear() {
    this.box.hidden = true;
    this.node.replaceChildren();
    this.confirm.value = '';
    clearMessage(element('fleet-cluster-state', HTMLElement));
  }

  private refuse(key: 'fleetSwitchoverTyped' | 'fleetSingleInvalid') {
    this.status.hidden = false;
    feedback(this.status, key, {}, 'error');
  }

  private async switchover() {
    const node = this.node.value;
    if (!node || this.confirm.value.trim() !== node) {
      this.refuse('fleetSwitchoverTyped');
      return;
    }
    if (!(await confirmAction('fleetSwitchoverAsk', { node }, 'fleetSwitchover'))) return;
    if (await this.submit({ kind: 'cluster-switchover', node, confirm: node }))
      this.confirm.value = '';
  }

  /** In a cluster still short of copies this stops writes again: asked first. */
  private async withdraw() {
    if (!(await confirmAction('fleetSingleOffAsk', {}, 'fleetSingleOff'))) return;
    await this.submit({ kind: 'single-copy', until: null, reason: 'withdrawn' });
  }

  private async singleCopy() {
    const local = element('fleet-single-until', HTMLInputElement).value;
    const reason = element('fleet-single-reason', HTMLInputElement).value.trim();
    // The field has no zone: it is this browser's time, sent as UTC.
    const until = local ? new Date(local) : null;
    if (!until || !Number.isFinite(until.getTime()) || !reason) {
      this.refuse('fleetSingleInvalid');
      return;
    }
    const iso = until.toISOString();
    if (!(await confirmAction('fleetSingleAsk', { until: iso }, 'fleetSingleOn'))) return;
    await this.submit({ kind: 'single-copy', until: iso, reason });
  }
}

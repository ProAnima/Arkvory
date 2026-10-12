import type { Replication, ReplicationPeer } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { showView } from './shell.js';

/** Cluster commands run from the package on Linux, where the release lives under this root. */
const ROOT = '/opt/proanima-arkvory';
type Known = Extract<Replication, { kind: 'known' }>;

function copyKey(peer: ReplicationPeer): MessageKey {
  if (peer.witness) return 'clusterCopyNone';
  if (peer.complete) return 'clusterCopyComplete';
  return peer.connected ? 'clusterCopySyncing' : 'clusterCopyMissing';
}

function cell(key: MessageKey, params: Readonly<Record<string, string>> = {}) {
  const td = document.createElement('td');
  message(td, key, params);
  return td;
}

/** An example end of a single-copy decision, in UTC as the command requires; people edit it. */
const hoursFrom = (now: number, hours: number) =>
  new Date(now + hours * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The next step for the state the cluster is in, with the command to run on the serving node. */
function nextStep(
  state: Replication,
  now: number,
): { key: MessageKey; command: string; replace: boolean } {
  if (state.kind !== 'known')
    return {
      key: 'clusterUnknown',
      command: `systemctl status arkvory-replica && arkvory cluster-status --root ${ROOT}`,
      replace: false,
    };
  if (state.copies < state.required)
    return {
      key: 'clusterDegraded',
      command: `arkvory cluster-single-copy --root ${ROOT} --until ${hoursFrom(now, 4)} --reason "<why>"`,
      replace: true,
    };
  if (state.singleCopyUntil)
    return {
      key: 'clusterSingle',
      command: `arkvory cluster-single-copy --root ${ROOT} --off`,
      replace: false,
    };
  const target = state.cluster?.peers.find((peer) => peer.complete && !peer.witness)?.name;
  return {
    key: 'clusterHealthy',
    command: `arkvory cluster-switchover --to ${target ?? '<node>'}`,
    replace: false,
  };
}

/**
 * The Cluster page (ADR 0072): the layout, the serving node, copies and writes, every other
 * node, and the one next step that fits. It renders what readiness reports; it changes nothing.
 */
export class ClusterView {
  readonly nav = element('cluster-nav', HTMLButtonElement);
  private readonly status = element('cluster-status', HTMLOutputElement);
  render(state: Replication | null, administrator: boolean) {
    this.nav.hidden = !administrator || state === null || state.kind === 'standalone';
    if (this.nav.hidden || state === null || state.kind === 'standalone') return;
    this.status.hidden = true;
    const known = state.kind === 'known' ? state : null;
    const cluster = known?.cluster ?? null;
    const profile = element('cluster-profile', HTMLElement);
    if (cluster)
      message(profile, cluster.profile === 'ha-2' ? 'clusterProfileTwo' : 'clusterProfileThree');
    else profile.textContent = '—';
    element('cluster-active', HTMLElement).textContent = cluster?.node ?? '—';
    const copies = element('cluster-copies', HTMLElement);
    if (known)
      message(copies, 'clusterCopiesValue', { copies: known.copies, required: known.required });
    else copies.textContent = '—';
    this.writes(known);
    this.peers(cluster?.peers ?? []);
    element('cluster-old', HTMLElement).hidden = known === null || cluster !== null;
    const step = nextStep(state, Date.now());
    message(element('cluster-step', HTMLElement), step.key);
    element('cluster-command', HTMLElement).textContent = step.command;
    element('cluster-replace', HTMLElement).hidden = !step.replace;
  }
  unavailable() {
    if (this.nav.hidden) return;
    this.status.hidden = false;
    message(this.status, 'clusterUnavailable');
  }
  clear() {
    this.nav.hidden = true;
    if (!element('cluster-panel', HTMLElement).hidden) showView('catalog');
  }
  private writes(known: Known | null) {
    const writes = element('cluster-writes', HTMLElement);
    const accepted = known !== null && known.copies >= known.required;
    writes.dataset['state'] = accepted ? 'on' : 'off';
    if (!accepted) message(writes, 'clusterWritesOff');
    else if (known.singleCopyUntil)
      message(writes, 'clusterWritesSingle', { until: known.singleCopyUntil }, [], ['until']);
    else message(writes, 'clusterWritesOn');
  }
  private peers(peers: readonly ReplicationPeer[]) {
    element('cluster-no-peers', HTMLElement).hidden = peers.length > 0;
    element('cluster-peers-table', HTMLElement).hidden = peers.length === 0;
    element('cluster-peers', HTMLTableSectionElement).replaceChildren(
      ...peers.map((peer) => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = peer.name;
        const copy = cell(copyKey(peer));
        copy.dataset['state'] = peer.witness ? 'none' : peer.complete ? 'on' : 'off';
        row.append(
          name,
          cell(peer.witness ? 'clusterRoleWitness' : 'clusterRoleData'),
          cell(peer.connected ? 'clusterConnected' : 'clusterDisconnected'),
          copy,
        );
        return row;
      }),
    );
  }
}

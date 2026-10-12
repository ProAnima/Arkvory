import type { ArkvoryClient, Replication } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { message } from './i18n.js';
import { ClusterView } from './cluster-view.js';

/** Administrators follow a cluster closely; other people only need to know uploads paused. */
const ADMINISTRATOR_MS = 15000;
const READER_MS = 60000;

/**
 * When an HA cluster stops acknowledging writes (ADR 0072): administrators get the reason and a
 * way to the Cluster page, everyone else a short notice that uploads pause and downloads work.
 */
export class ReplicationBanner {
  private readonly banner = element('replication-banner', HTMLElement);
  private readonly notice = element('replication-notice', HTMLElement);
  private readonly open = element('replication-open', HTMLButtonElement);
  private readonly cluster = new ClusterView();
  private generation = 0;
  private administrator = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly client: ArkvoryClient) {}
  /** Settles after the first state, which shows or hides the Cluster entry. */
  connect(administrator: boolean): Promise<void> {
    this.clear();
    this.administrator = administrator;
    return this.poll(this.generation);
  }
  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.banner.hidden = true;
    this.cluster.clear();
  }
  private async poll(generation: number) {
    try {
      const state = await this.client.replication.state();
      if (generation === this.generation) this.render(state);
    } catch {
      // Readiness is unavailable while the server drains or restarts; the next poll shows it.
      if (generation === this.generation) this.cluster.unavailable();
    }
    if (generation === this.generation)
      this.timer = setTimeout(
        () => {
          void this.poll(generation);
        },
        this.administrator ? ADMINISTRATOR_MS : READER_MS,
      );
  }
  private render(state: Replication) {
    this.cluster.render(state, this.administrator);
    const stopped =
      state.kind === 'unknown' || (state.kind === 'known' && state.copies < state.required);
    const single = state.kind === 'known' && !stopped && state.singleCopyUntil !== null;
    this.open.hidden = !this.administrator;
    if (!this.administrator) {
      this.banner.hidden = !stopped;
      if (stopped) message(this.notice, 'replicationReaders');
      return;
    }
    if (state.kind === 'unknown') message(this.notice, 'replicationUnknown');
    else if (state.kind === 'known' && stopped)
      message(this.notice, 'replicationDegraded', {
        copies: state.copies,
        required: state.required,
      });
    else if (state.kind === 'known' && single && state.singleCopyUntil)
      message(
        this.notice,
        'replicationSingleCopy',
        { until: state.singleCopyUntil },
        [],
        ['until'],
      );
    this.banner.hidden = !stopped && !single;
  }
}

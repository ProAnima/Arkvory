import type { ArkvoryClient, Replication } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { message } from './i18n.js';

/** Administrators see when an HA cluster stops acknowledging writes (ADR 0072). */
export class ReplicationBanner {
  private readonly banner = element('replication-banner', HTMLElement);
  private readonly notice = element('replication-notice', HTMLElement);
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly client: ArkvoryClient) {}
  connect(administrator: boolean) {
    this.clear();
    if (administrator) void this.poll(this.generation);
  }
  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.banner.hidden = true;
  }
  private async poll(generation: number) {
    try {
      const state = await this.client.replication.state();
      if (generation === this.generation) this.render(state);
    } catch {
      // Readiness is unavailable while the server drains or restarts; the next poll shows it.
    }
    if (generation === this.generation)
      this.timer = setTimeout(() => {
        void this.poll(generation);
      }, 15000);
  }
  private render(state: Replication) {
    if (state.kind === 'unknown') message(this.notice, 'replicationUnknown');
    else if (state.kind === 'known' && state.copies < state.required)
      message(this.notice, 'replicationDegraded', {
        copies: state.copies,
        required: state.required,
      });
    else if (state.kind === 'known' && state.singleCopyUntil)
      message(
        this.notice,
        'replicationSingleCopy',
        { until: state.singleCopyUntil },
        [],
        ['until'],
      );
    else {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
  }
}

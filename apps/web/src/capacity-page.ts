import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { bytesMessage, clearMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { showFailure } from './feedback.js';
import { onViewOpen, showView } from './shell.js';

type Usage = Awaited<ReturnType<ArkvoryClient['storageUsage']>>;
type Tone = 'success' | 'warning' | 'error' | 'neutral';
type Entry = { readonly id: string; readonly usage: Usage | null };

/** Bounds of one pass: how many repositories are read and how many reads run at once. */
const MAX_REPOSITORIES = 500;
const PARALLEL_READS = 4;

const states: Readonly<Record<Usage['state'], readonly [MessageKey, Tone]>> = {
  unlimited: ['capacityUnlimited', 'neutral'],
  normal: ['capacityNormal', 'success'],
  warning: ['capacityWarning', 'warning'],
  critical: ['capacityCritical', 'error'],
  exceeded: ['capacityExceeded', 'error'],
};

/**
 * Repositories this account may read the storage of, in id order, at most `limit`; paging stops
 * as soon as more are found, so deciding whether to show the entry reads one match only.
 */
async function storageRepositories(
  client: ArkvoryClient,
  signal: AbortSignal,
  limit = MAX_REPOSITORIES,
) {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await client.repositories({ limit: 100, ...(after ? { after } : {}) }, signal);
    if (page.next && after && page.next <= after) throw new Error('Invalid repository pagination');
    for (const card of page.items) if (card.permissions.includes('storage.read')) ids.push(card.id);
    if (ids.length > limit) return { ids: ids.slice(0, limit), truncated: true };
    if (!page.next) return { ids, truncated: false };
    after = page.next;
  }
}

/** Reads usage with a fixed number of reads in flight; one failing repository stays a row. */
async function readUsage(client: ArkvoryClient, ids: readonly string[], signal: AbortSignal) {
  const entries: Entry[] = ids.map((id) => ({ id, usage: null }));
  let next = 0;
  const worker = async () => {
    while (next < entries.length && !signal.aborted) {
      const index = next++;
      const entry = entries[index];
      if (!entry) return;
      try {
        entries[index] = { id: entry.id, usage: await client.storageUsage(entry.id, signal) };
      } catch {
        // The row says it could not be read; an abort ends the loop on its next check.
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_READS }, worker));
  return entries;
}

const used = (entry: Entry) => BigInt(entry.usage?.reservedBytes ?? '0');
const sum = (entries: readonly Entry[], pick: (usage: Usage) => string) =>
  String(entries.reduce((total, e) => total + BigInt(e.usage ? pick(e.usage) : '0'), 0n));

/** The size sits in its own node: a translation rewrites that node, not the bar beside it. */
function bytesCell(value: string | null) {
  const td = document.createElement('td');
  const size = document.createElement('span');
  if (value === null) message(size, 'capacityNoQuota');
  else bytesMessage(size, value);
  td.append(size);
  return td;
}

/** The share of the quota in use, 0–100; beyond the quota the bar is simply full. */
function share(usage: Usage) {
  if (usage.quotaBytes === null) return null;
  const quota = BigInt(usage.quotaBytes);
  const percent = (BigInt(usage.reservedBytes) * 100n) / (quota === 0n ? 1n : quota);
  return Number(percent > 100n ? 100n : percent);
}

export class CapacityPage {
  private readonly nav = element('capacity-nav', HTMLButtonElement);
  private readonly status = element('capacity-status', HTMLOutputElement);
  private readonly rows = element('capacity-rows', HTMLTableSectionElement);
  private controller = new AbortController();
  constructor(
    private readonly client: ArkvoryClient,
    private readonly open: (repository: string) => void,
  ) {
    onViewOpen('capacity', () => {
      void this.load();
    });
    element('capacity-refresh', HTMLButtonElement).addEventListener('click', () => {
      void this.load();
    });
  }
  /** The entry shows for accounts that may read the storage of at least one repository. */
  async connect() {
    this.clear();
    const signal = this.controller.signal;
    try {
      // A limit of 0 stops at the first match: `truncated` then means there is at least one.
      const { truncated } = await storageRepositories(this.client, signal, 0);
      if (!signal.aborted) this.nav.hidden = !truncated;
    } catch {
      // Without the list the entry stays hidden; the catalog reports connection problems.
    }
  }
  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    this.nav.hidden = true;
    this.status.hidden = true;
    clearMessage(this.status);
    this.rows.replaceChildren();
    if (!element('capacity-panel', HTMLElement).hidden) showView('catalog');
  }
  private async load() {
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const refresh = element('capacity-refresh', HTMLButtonElement);
    refresh.disabled = true;
    this.status.hidden = true;
    try {
      const { ids, truncated } = await storageRepositories(this.client, signal);
      const entries = await readUsage(this.client, ids, signal);
      if (signal.aborted) return;
      this.render(entries, truncated);
    } catch (error) {
      if (signal.aborted) return;
      this.status.hidden = false;
      showFailure(this.status, error);
    } finally {
      if (!signal.aborted) refresh.disabled = false;
    }
  }
  private render(entries: readonly Entry[], truncated: boolean) {
    const read = entries.filter((entry) => entry.usage !== null);
    const facts: [string, string][] = [
      ['capacity-total', sum(read, (u) => u.reservedBytes)],
      ['capacity-published', sum(read, (u) => u.publishedBytes)],
      ['capacity-retired', sum(read, (u) => u.retiredBytes)],
    ];
    for (const [id, value] of facts) bytesMessage(element(id, HTMLElement), value);
    message(element('capacity-count', HTMLElement), 'capacityCountValue', {
      count: entries.length,
    });
    const attention = read.filter(
      (e) => e.usage && !['unlimited', 'normal'].includes(e.usage.state),
    );
    message(element('capacity-attention', HTMLElement), 'capacityCountValue', {
      count: attention.length,
    });
    element('capacity-empty', HTMLElement).hidden = entries.length > 0;
    element('capacity-table', HTMLElement).hidden = entries.length === 0;
    element('capacity-truncated', HTMLElement).hidden = !truncated;
    const sorted = [...entries].sort((a, b) => {
      const difference = used(b) - used(a);
      return difference === 0n ? a.id.localeCompare(b.id) : difference > 0n ? 1 : -1;
    });
    this.rows.replaceChildren(...sorted.map((entry) => this.row(entry)));
  }
  private row(entry: Entry) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-button';
    link.textContent = entry.id;
    link.addEventListener('click', () => {
      this.open(entry.id);
    });
    name.append(link);
    const usage = entry.usage;
    if (!usage) {
      const state = document.createElement('td');
      state.colSpan = 6;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset['tone'] = 'error';
      message(badge, 'capacityUnreadable');
      state.append(badge);
      tr.append(name, state);
      return tr;
    }
    const inUse = bytesCell(usage.reservedBytes);
    const percent = share(usage);
    if (percent !== null) {
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = percent;
      const [, tone] = states[usage.state];
      bar.dataset['tone'] = tone;
      message(bar, 'capacityShare', { percent });
      inUse.append(bar);
    }
    const [key, tone] = states[usage.state];
    const state = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    if (tone !== 'neutral') badge.dataset['tone'] = tone;
    message(badge, key);
    state.append(badge);
    tr.append(
      name,
      inUse,
      bytesCell(usage.quotaBytes),
      bytesCell(usage.publishedBytes),
      bytesCell(usage.pendingBytes),
      bytesCell(usage.retiredBytes),
      state,
    );
    return tr;
  }
}

import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';
import { hostOf, mirrorState, stateKeys } from './mirror-presentation.js';
import { mirrorReasonView } from './mirror-reason.js';
import { onViewOpen, showView } from './shell.js';

/** While the page is open it follows the server's synchronization without a reload. */
const REFRESH_MS = 20000;

function cell(...children: Node[]) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}
function text(tag: string, key: Parameters<typeof message>[1], params = {}, bytes: string[] = []) {
  const node = document.createElement(tag);
  message(node, key, params, bytes);
  return node;
}

/**
 * The Mirrors page (ADR 0058): every mirror and import whose repository the person may read,
 * with its state and, when stopped, why and what to do. Administrators always see the entry
 * (with how to set one up while there is none); others only when a mirror is visible to them.
 */
export class MirrorsPage {
  private readonly nav = element('mirrors-nav', HTMLButtonElement);
  private readonly panel = element('mirrors-panel', HTMLElement);
  private readonly rows = element('mirrors-rows', HTMLTableSectionElement);
  private readonly status = element('mirrors-status', HTMLOutputElement);
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly client: ArkvoryClient,
    private readonly open: (repository: string) => void,
  ) {
    onViewOpen('mirrors', () => {
      void this.refresh(this.generation);
    });
  }
  /** Settles once it is known whether the entry shows. */
  async connect(administrator: boolean): Promise<void> {
    this.clear();
    const generation = this.generation;
    const items = await this.refresh(generation);
    if (generation !== this.generation) return;
    this.nav.hidden = !administrator && (items === null || items.length === 0);
    this.schedule(generation);
  }
  clear() {
    this.generation++;
    clearTimeout(this.timer);
    this.nav.hidden = true;
    this.rows.replaceChildren();
    if (!this.panel.hidden) showView('catalog');
  }
  private schedule(generation: number) {
    this.timer = setTimeout(() => {
      // Only an open page reads again; opening it reads at once.
      const next = this.panel.hidden ? Promise.resolve(null) : this.refresh(generation);
      void next.then(() => {
        if (generation === this.generation) this.schedule(generation);
      });
    }, REFRESH_MS);
  }
  private async refresh(generation: number) {
    try {
      const { items } = await this.client.mirrors();
      if (generation !== this.generation) return null;
      this.status.hidden = true;
      this.render(items);
      return items;
    } catch {
      if (generation === this.generation) {
        this.status.hidden = false;
        message(this.status, 'mirrorsUnavailable');
      }
      return null;
    }
  }
  private render(items: readonly RepositoryMirrorResponse[]) {
    element('mirrors-empty', HTMLElement).hidden = items.length > 0;
    element('mirrors-table', HTMLElement).hidden = items.length === 0;
    this.rows.replaceChildren(...items.map((item) => this.row(item)));
  }
  private row(item: RepositoryMirrorResponse) {
    const repository = document.createElement('button');
    repository.type = 'button';
    repository.className = 'secondary small';
    // The name is the accessible name: opening the repository is what a name link does here.
    repository.textContent = item.repository;
    repository.onclick = () => {
      this.open(item.repository);
    };
    const source = text('div', 'mirrorsSourceValue', {
      source: item.sourceRepository,
      upstream: hostOf(item.upstream),
    });
    const mode =
      item.mode === 'import'
        ? text('div', 'mirrorsModeImport', { stages: item.stages.join(', ') })
        : text('div', 'mirrorsModeMirror');
    mode.className = 'hint';
    const state = mirrorState(item);
    const badge = text('span', stateKeys[state]);
    badge.className = 'badge mirror-badge';
    badge.dataset['state'] = state;
    const reason = mirrorReasonView(item);
    const synced = document.createElement('span');
    if (item.syncedAt) relativeMessage(synced, item.syncedAt);
    else message(synced, 'mirrorNever');
    const copied = text(
      'span',
      'mirrorsCopiedValue',
      { count: item.copiedArtifacts, size: item.copiedBytes },
      ['size'],
    );
    const row = document.createElement('tr');
    row.append(
      cell(repository),
      cell(source, mode),
      cell(badge, ...(reason ? [reason] : [])),
      cell(synced),
      cell(copied),
    );
    return row;
  }
}

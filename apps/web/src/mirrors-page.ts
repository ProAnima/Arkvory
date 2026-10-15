import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message, relativeMessage } from './i18n.js';
import { hostOf, mirrorState, stageList, stateKeys } from './mirror-presentation.js';
import { mirrorReasonView, showConflicts } from './mirror-reason.js';
import { onViewOpen, showView } from './shell.js';
import { showFailure } from './feedback.js';

/** While the page is open it follows the server's synchronization without a reload. */
const REFRESH_MS = 20000;

/** The nodes of one row, updated in place: focus and a text selection survive a refresh. */
interface Row {
  readonly row: HTMLTableRowElement;
  readonly source: HTMLElement;
  readonly mode: HTMLElement;
  readonly badge: HTMLElement;
  readonly reason: HTMLElement;
  readonly conflicts: HTMLElement;
  readonly synced: HTMLElement;
  readonly copied: HTMLElement;
}

function cell(...children: Node[]) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}

/** Leaving a screen while someone types into the connection card would take their keystrokes. */
const typingInConnection = () =>
  document.activeElement instanceof HTMLElement &&
  document.activeElement.closest('#connection-card') !== null;

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
  private readonly shown = new Map<string, Row>();
  private generation = 0;
  /** Only the newest read renders: an open view and the timer may read at the same time. */
  private request = 0;
  /** Whether a list was read since connecting; until then the entry may wrongly stay hidden. */
  private known = false;
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
    this.nav.hidden = !administrator;
    const generation = this.generation;
    await this.refresh(generation);
    if (generation !== this.generation) return;
    this.schedule(generation);
  }
  clear() {
    this.generation++;
    this.known = false;
    clearTimeout(this.timer);
    this.nav.hidden = true;
    this.shown.clear();
    this.rows.replaceChildren();
    if (!this.panel.hidden && !typingInConnection()) showView('catalog');
  }
  private schedule(generation: number) {
    this.timer = setTimeout(() => {
      // Only an open page reads again (opening it reads at once), and a session whose first
      // read failed, so the entry of someone who may see a mirror still appears.
      const next = this.panel.hidden && this.known ? Promise.resolve() : this.refresh(generation);
      void next.then(() => {
        if (generation === this.generation) this.schedule(generation);
      });
    }, REFRESH_MS);
  }
  private async refresh(generation: number): Promise<void> {
    const request = ++this.request;
    const current = () => generation === this.generation && request === this.request;
    try {
      const { items } = await this.client.mirrors();
      if (!current()) return;
      this.status.hidden = true;
      this.render(items);
      this.known = true;
      if (items.length > 0) this.nav.hidden = false;
    } catch (error) {
      if (current()) {
        this.status.hidden = false;
        showFailure(this.status, error);
      }
    }
  }
  private render(items: readonly RepositoryMirrorResponse[]) {
    element('mirrors-empty', HTMLElement).hidden = items.length > 0;
    element('mirrors-table', HTMLElement).hidden = items.length === 0;
    const present = new Set(items.map((item) => item.repository));
    for (const [repository, row] of this.shown)
      if (!present.has(repository)) {
        row.row.remove();
        this.shown.delete(repository);
      }
    items.forEach((item, index) => {
      const row = this.shown.get(item.repository) ?? this.create(item.repository);
      this.update(row, item);
      // Moved only when out of place: moving a node takes the focus out of it.
      if (this.rows.rows[index] !== row.row)
        this.rows.insertBefore(row.row, this.rows.rows[index] ?? null);
    });
  }
  private create(repository: string): Row {
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'link-button';
    // The name is the accessible name: opening the repository is what a name link does here.
    name.textContent = repository;
    name.onclick = () => {
      this.open(repository);
    };
    const [source, mode, badge, reason, conflicts, synced, copied] = [
      'div',
      'div',
      'span',
      'div',
      'div',
      'span',
      'span',
    ].map((tag) => document.createElement(tag)) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    mode.className = 'hint';
    badge.className = 'badge mirror-badge';
    const row = document.createElement('tr');
    row.append(
      cell(name),
      cell(source, mode),
      cell(badge, reason, conflicts),
      cell(synced),
      cell(copied),
    );
    const created = { row, source, mode, badge, reason, conflicts, synced, copied };
    this.shown.set(repository, created);
    return created;
  }
  private update(row: Row, item: RepositoryMirrorResponse) {
    message(row.source, 'mirrorsSourceValue', {
      source: item.sourceRepository,
      upstream: hostOf(item.upstream),
    });
    if (item.mode === 'import')
      message(row.mode, 'mirrorsModeImport', { stages: stageList(item.stages) });
    else message(row.mode, 'mirrorsModeMirror');
    const state = mirrorState(item);
    message(row.badge, stateKeys[state]);
    row.badge.dataset['state'] = state;
    // The reason is rebuilt only when it changes: its link and command keep focus and selection.
    const code = item.errorCode ?? '';
    if (row.reason.dataset['code'] !== code) {
      row.reason.dataset['code'] = code;
      const view = mirrorReasonView(item);
      row.reason.replaceChildren(...(view ? [view] : []));
    }
    showConflicts(row.conflicts, item);
    if (item.syncedAt) relativeMessage(row.synced, item.syncedAt);
    else {
      clearMessage(row.synced);
      message(row.synced, 'mirrorNever');
    }
    message(
      row.copied,
      'mirrorsCopiedValue',
      { count: item.copiedArtifacts, size: item.copiedBytes },
      ['size'],
    );
  }
}

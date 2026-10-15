import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { ArtifactSearchItemResponse, AssetResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { bytesMessage, dateMessage, message } from './i18n.js';
import { showFailure } from './feedback.js';

/** A site can hold many repositories; the picker lists at most this many. */
const MAX_REPOSITORY_PAGES = 10;

type Remote = ReturnType<ArkvoryClient['fleet']['site']>;

const text = (value: string) => {
  const td = document.createElement('td');
  // Names, paths and labels come from another installation: text, never markup.
  td.textContent = value;
  return td;
};

/**
 * The content of one managed site (ADR 0077, stage F2): its repositories, artifacts and files,
 * read through this installation. Metadata only; bytes stay on the site.
 */
export class FleetContent {
  private readonly card = element('fleet-content', HTMLElement);
  private readonly title = element('fleet-content-title', HTMLElement);
  private readonly repository = element('fleet-repository', HTMLSelectElement);
  private readonly query = element('fleet-query', HTMLInputElement);
  private readonly status = element('fleet-content-status', HTMLOutputElement);
  private readonly artifacts = element('fleet-artifact-rows', HTMLTableSectionElement);
  private readonly files = element('fleet-file-rows', HTMLTableSectionElement);
  private readonly artifactsMore = element('fleet-artifacts-more', HTMLButtonElement);
  private readonly filesMore = element('fleet-files-more', HTMLButtonElement);
  private remote: Remote | null = null;
  /** The site shown, so removing it from the list closes its content. */
  current: string | null = null;
  /** Answers of an earlier site, repository or filter are dropped when they arrive late. */
  private generation = 0;
  private artifactsNext: string | null = null;
  private filesNext: string | null = null;
  /**
   * The repository and filter of the pages shown, taken at load: "more" continues those pages,
   * not whatever the field holds now (a cursor belongs to its query).
   */
  private filter = { repository: '', text: '' };

  constructor(private readonly client: ArkvoryClient) {
    element('fleet-content-close', HTMLButtonElement).onclick = () => {
      this.clear();
    };
    element('fleet-content-filter', HTMLFormElement).onsubmit = (event) => {
      event.preventDefault();
      void this.load();
    };
    this.repository.onchange = () => void this.load();
    this.artifactsMore.onclick = () =>
      void this.more(this.artifactsMore, () => this.moreArtifacts());
    this.filesMore.onclick = () => void this.more(this.filesMore, () => this.moreFiles());
  }

  async open(id: string, name: string) {
    this.clear();
    this.remote = this.client.fleet.site(id);
    this.current = id;
    message(this.title, 'fleetContentOf', { name });
    this.card.hidden = false;
    this.card.scrollIntoView({ block: 'nearest' });
    const generation = this.generation;
    await this.guard(generation, async () => {
      const ids = await this.repositories();
      if (generation !== this.generation) return;
      this.repository.replaceChildren(
        ...ids.map((repository) => new Option(repository, repository)),
      );
      if (ids.length === 0) {
        this.status.hidden = false;
        message(this.status, 'fleetNoRepositories');
        return;
      }
      await this.load();
    });
  }

  clear() {
    this.generation++;
    this.remote = null;
    this.current = null;
    this.card.hidden = true;
    this.repository.replaceChildren();
    this.query.value = '';
    this.status.hidden = true;
    this.reset();
  }

  private reset() {
    this.artifacts.replaceChildren();
    this.files.replaceChildren();
    this.artifactsNext = null;
    this.filesNext = null;
    this.artifactsMore.hidden = true;
    this.filesMore.hidden = true;
    element('fleet-artifacts-empty', HTMLElement).hidden = true;
    element('fleet-files-empty', HTMLElement).hidden = true;
  }

  private async repositories() {
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_REPOSITORY_PAGES && this.remote; page++) {
      const answer = await this.remote.repositories({ limit: 100, ...(after ? { after } : {}) });
      ids.push(...answer.items.map((item) => item.id));
      if (answer.next === null) break;
      after = answer.next;
    }
    return ids;
  }

  private async load() {
    this.generation++;
    this.status.hidden = true;
    this.reset();
    this.filter = { repository: this.repository.value, text: this.query.value.trim() };
    const generation = this.generation;
    await this.guard(generation, async () => {
      await Promise.all([this.moreArtifacts(), this.moreFiles()]);
    });
  }

  private async moreArtifacts() {
    const remote = this.remote;
    const { repository, text: q } = this.filter;
    if (!remote || !repository) return;
    const generation = this.generation;
    const page = await remote.search(repository, {
      ...(q ? { q } : {}),
      ...(this.artifactsNext ? { after: this.artifactsNext } : {}),
    });
    if (generation !== this.generation) return;
    this.artifacts.append(...page.items.map((item) => this.artifactRow(item)));
    this.artifactsNext = page.next;
    this.artifactsMore.hidden = page.next === null;
    element('fleet-artifacts-empty', HTMLElement).hidden = this.artifacts.rows.length > 0;
  }

  private async moreFiles() {
    const remote = this.remote;
    const { repository, text: prefix } = this.filter;
    if (!remote || !repository) return;
    const generation = this.generation;
    const page = await remote.assetPage(repository, {
      ...(prefix ? { prefix } : {}),
      ...(this.filesNext ? { after: this.filesNext } : {}),
    });
    if (generation !== this.generation) return;
    this.files.append(...page.items.map((item) => this.fileRow(item)));
    this.filesNext = page.next;
    this.filesMore.hidden = page.next === null;
    element('fleet-files-empty', HTMLElement).hidden = this.files.rows.length > 0;
  }

  private artifactRow(item: ArtifactSearchItemResponse) {
    const row = document.createElement('tr');
    const name = text(item.name);
    name.title = item.id;
    const size = document.createElement('td');
    bytesMessage(size, item.size);
    const published = document.createElement('td');
    dateMessage(published, item.publishedAt ?? item.createdAt);
    row.append(name, size, published, text([...item.labels, ...item.stages].join(', ') || '—'));
    return row;
  }

  private fileRow(item: AssetResponse) {
    const row = document.createElement('tr');
    row.append(text(item.path), text(String(item.revision)), text(item.artifactId));
    return row;
  }

  /** One page at a time: a second click cannot fetch the same page twice. */
  private async more(button: HTMLButtonElement, next: () => Promise<void>) {
    button.disabled = true;
    try {
      await this.guard(this.generation, next);
    } finally {
      button.disabled = false;
    }
  }

  private async guard(generation: number, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.hidden = false;
      showFailure(this.status, error);
    }
  }
}

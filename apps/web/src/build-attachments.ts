import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { BuildAttachmentResponse } from '@proanima/arkvory-contracts';
import { clearMessage, message } from './i18n.js';
import { feedback, UiError, showFailure } from './feedback.js';
import { hashFile } from './file-hash.js';
import { exceedsServerLimit } from './server-limits.js';
import { attachmentElements, attachmentKind, fileRow, historyEntry } from './attachment-view.js';
import type { AttachmentElements, RowActions, Selection } from './attachment-view.js';

const maximumAttachments = 32;
const uploadOperations = [
  'createUpload',
  'putUploadPart',
  'completeUpload',
  'getUpload',
  'listUploadParts',
];
/** A paused upload is resumed with the same idempotency key, upload ID and checksum. */
interface PendingUpload {
  file: File;
  key: string;
  id?: string;
  sha256?: string;
}

class BuildAttachments {
  private readonly ui: AttachmentElements = attachmentElements();
  private selected: Selection | undefined;
  private generation = 0;
  private busy = false;
  private controller: AbortController | undefined;
  private pending: PendingUpload | undefined;
  private next: number | null = null;
  private readonly actions: RowActions = {
    download: (selection, item) => {
      this.run(() => this.download(selection.repository, item.artifactId, item.name));
    },
    unlink: (selection, item) => {
      this.run(async () => {
        await this.replace(
          selection,
          selection.current.items.filter((entry) => entry.name !== item.name),
        );
        this.ui.reload.focus();
      });
    },
    restore: (selection, revision) => {
      this.run(async () => {
        await this.replace(selection, revision.items);
        this.ui.historyLoad.focus();
      });
    },
  };
  constructor(
    private readonly client: ArkvoryClient,
    private readonly download: (repo: string, id: string, name: string) => Promise<void>,
  ) {
    const ui = this.ui;
    ui.mode.onchange = () => {
      this.source();
    };
    ui.file.onchange = () => {
      this.pending = undefined;
      ui.uploadId.value = '';
      if (ui.file.files?.[0]) ui.name.value = ui.file.files[0].name;
    };
    ui.historyLoad.onclick = () => {
      this.run(() => this.loadHistory());
    };
    ui.more.onclick = () => {
      this.run(() => this.loadHistory(this.next ?? undefined));
    };
    ui.reload.onclick = () => {
      this.run(() => this.reload());
    };
    ui.pause.onclick = () => this.controller?.abort();
    ui.reset.onclick = () => {
      if (!this.busy) this.resetDraft();
    };
    ui.form.onsubmit = (event) => {
      event.preventDefault();
      this.run(() => this.submit());
    };
  }
  isUploading() {
    return this.controller !== undefined;
  }
  clear() {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.busy = false;
    this.selected = undefined;
    this.ui.panel.hidden = true;
    this.ui.list.replaceChildren();
    this.ui.history.replaceChildren();
    this.resetDraft();
    clearMessage(this.ui.status);
    this.controls();
  }
  async open(repository: string, id: string, operations: ReadonlySet<string>) {
    const request = ++this.generation;
    this.ui.panel.hidden = true;
    const current = await this.client.attachments(repository, id);
    if (request !== this.generation) return;
    const selection: Selection = {
      repository,
      id,
      current,
      canWrite: operations.has('replaceBuildAttachments'),
      canUpload: uploadOperations.every((operation) => operations.has(operation)),
      canDownload: operations.has('downloadArtifact'),
    };
    this.selected = selection;
    const uploadOption = this.ui.mode.querySelector<HTMLOptionElement>('option[value=upload]');
    if (uploadOption) uploadOption.disabled = !selection.canUpload;
    this.ui.mode.value = selection.canUpload ? 'upload' : 'existing';
    this.source();
    this.ui.panel.hidden = false;
    this.render(selection);
  }
  /** Errors of a cleared selection are not reported into the next artifact's panel. */
  private run(work: () => Promise<void>) {
    const generation = this.generation;
    void work().catch((error: unknown) => {
      if (generation === this.generation) showFailure(this.ui.status, error);
    });
  }
  private source() {
    const uploading = this.ui.mode.value === 'upload';
    this.ui.fileLabel.hidden = !uploading;
    this.ui.idLabel.hidden = uploading;
    this.ui.file.required = uploading;
    this.ui.target.required = !uploading;
  }
  private controls() {
    const { ui, selected, busy } = this;
    ui.fields.disabled = busy || !selected?.canWrite;
    ui.submit.disabled =
      busy || !selected?.canWrite || selected.current.items.length >= maximumAttachments;
    ui.pause.disabled = !this.controller;
    ui.reset.disabled = busy;
    ui.reload.disabled = busy || !selected;
    ui.form.hidden = !selected?.canWrite;
    for (const button of ui.panel.querySelectorAll<HTMLButtonElement>('[data-attachment-mutation]'))
      button.disabled = busy || !selected?.canWrite;
  }
  private render(selection: Selection) {
    const { ui } = this;
    ui.list.replaceChildren(
      ...selection.current.items.map((item) => fileRow(item, selection, this.actions, true)),
    );
    ui.empty.hidden = selection.current.items.length > 0;
    message(ui.count, 'attachmentCount', {
      count: selection.current.items.length,
      revision: selection.current.revision,
    });
    this.controls();
  }
  private async replace(selection: Selection, items: readonly BuildAttachmentResponse[]) {
    if (this.busy || this.selected !== selection) return;
    this.busy = true;
    this.controls();
    try {
      const updated = await this.client.replaceAttachments(
        selection.repository,
        selection.id,
        selection.current.revision,
        items,
      );
      if (this.selected !== selection) return;
      selection.current = updated;
      this.render(selection);
      this.ui.history.replaceChildren();
      this.next = null;
      this.ui.more.disabled = true;
      feedback(this.ui.status, 'attachmentSaved', { revision: updated.revision }, 'success');
    } finally {
      if (this.selected === selection) {
        this.busy = false;
        this.controls();
      }
    }
  }
  private async loadHistory(before?: number) {
    const selection = this.selected;
    if (!selection) return;
    this.ui.more.disabled = true;
    const page = await this.client.attachmentHistory(selection.repository, selection.id, before);
    if (this.selected !== selection) return;
    if (before === undefined) this.ui.history.replaceChildren();
    for (const revision of page.items)
      this.ui.history.append(historyEntry(revision, selection, this.actions));
    if (!page.items.length && before === undefined) {
      const empty = document.createElement('p');
      message(empty, 'attachmentHistoryEmpty');
      this.ui.history.append(empty);
    }
    this.next = page.next;
    this.ui.more.disabled = this.next === null;
    this.controls();
  }
  private async reload() {
    const selection = this.selected;
    if (!selection || this.busy) return;
    const current = await this.client.attachments(selection.repository, selection.id);
    if (this.selected === selection) {
      selection.current = current;
      this.render(selection);
      feedback(this.ui.status, 'attachmentReloaded');
    }
  }
  private resetDraft() {
    this.pending = undefined;
    this.ui.form.reset();
    this.ui.mode.value = this.selected?.canUpload ? 'upload' : 'existing';
    this.ui.uploadId.value = '';
    this.ui.progress.value = 0;
    this.source();
  }
  private async submit() {
    const selection = this.selected;
    if (!selection || this.busy) return;
    const { ui } = this;
    if (!selection.canWrite || selection.current.items.length >= maximumAttachments)
      throw new UiError('errorInput');
    const kind = attachmentKind(ui.kind.value);
    if (!kind) throw new UiError('errorInput');
    const entryName = ui.name.value.trim();
    if (selection.current.items.some((item) => item.name.toLowerCase() === entryName.toLowerCase()))
      throw new UiError('attachmentDuplicate');
    const artifactId =
      ui.mode.value === 'upload' ? await this.upload(selection) : ui.target.value.trim();
    if (this.selected !== selection) return;
    await this.replace(selection, [
      ...selection.current.items,
      { name: entryName, kind, artifactId, description: ui.description.value },
    ]);
    if (this.selected === selection) {
      this.resetDraft();
      ui.name.focus();
    }
  }
  private async upload(selection: Selection): Promise<string> {
    const { ui } = this;
    const current = ui.file.files?.[0];
    if (!current) throw new UiError('chooseFileError');
    if (!selection.canUpload) throw new UiError('errorForbidden');
    if (await exceedsServerLimit(this.client, current.size)) throw new UiError('fileTooLarge');
    this.pending ??= { file: current, key: crypto.randomUUID() };
    const attempt = this.pending;
    this.controller = new AbortController();
    const signal = this.controller.signal,
      visible = () => this.selected === selection;
    this.busy = true;
    ui.progress.max = Math.max(1, current.size);
    this.controls();
    try {
      if (!attempt.sha256) {
        feedback(ui.status, 'hashing');
        attempt.sha256 = await hashFile(attempt.file, signal, (bytes) => {
          if (visible()) ui.progress.value = bytes;
        });
      }
      if (!attempt.id) {
        const created = await this.client.create(
          selection.repository,
          attempt.key,
          {
            name: attempt.file.name,
            size: String(attempt.file.size),
            sha256: attempt.sha256,
            labels: [],
            metadata: {},
          },
          signal,
        );
        attempt.id = created.id;
        if (visible()) ui.uploadId.value = created.id;
      }
      await this.client.resume(selection.repository, attempt.id, attempt.file, {
        signal,
        onProgress: (bytes) => {
          if (!visible()) return;
          ui.progress.value = bytes;
          feedback(ui.status, 'uploading', {
            percent: Math.round((bytes / Math.max(1, current.size)) * 100),
          });
        },
      });
      return attempt.id;
    } finally {
      if (visible()) {
        this.busy = false;
        this.controller = undefined;
        this.controls();
      }
    }
  }
}

export function installBuildAttachments(
  client: ArkvoryClient,
  download: (repo: string, id: string, name: string) => Promise<void>,
) {
  const attachments = new BuildAttachments(client, download);
  return {
    isUploading: () => attachments.isUploading(),
    clear: () => {
      attachments.clear();
    },
    open: (repository: string, id: string, operations: ReadonlySet<string>) =>
      attachments.open(repository, id, operations),
  };
}

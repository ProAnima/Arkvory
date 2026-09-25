import type { DepotClient } from '@proanima/depot-sdk';
import type {
  AttachmentRevisionResponse,
  BuildAttachmentResponse,
} from '@proanima/depot-contracts';
import { element } from './dom.js';
import { message, dateMessage } from './i18n.js';
import { feedback, errorKey, UiError } from './feedback.js';
import { hashFile } from './file-hash.js';
import type { MessageKey } from './messages.js';

const kindMessages: Record<BuildAttachmentResponse['kind'], MessageKey> = {
  manifest: 'attachmentManifest',
  sbom: 'attachmentSbom',
  signature: 'attachmentSignature',
  report: 'attachmentReport',
  file: 'attachmentFile',
};
interface Selection {
  repository: string;
  id: string;
  current: AttachmentRevisionResponse;
  canWrite: boolean;
  canUpload: boolean;
  canDownload: boolean;
}
// depot-exception ARCH-023 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installBuildAttachments(
  client: DepotClient,
  download: (repo: string, id: string, name: string) => Promise<void>,
) {
  const panel = element('build-attachments', HTMLElement),
    list = element('attachment-list', HTMLDivElement);
  const form = element('attachment-form', HTMLFormElement),
    fields = element('attachment-fields', HTMLFieldSetElement);
  const file = element('attachment-file', HTMLInputElement),
    mode = element('attachment-source', HTMLSelectElement);
  const name = element('attachment-name', HTMLInputElement),
    target = element('attachment-id', HTMLInputElement);
  const kind = element('attachment-kind', HTMLSelectElement),
    description = element('attachment-description', HTMLInputElement);
  const status = element('attachment-status', HTMLOutputElement),
    progress = element('attachment-progress', HTMLProgressElement);
  const pause = element('attachment-pause', HTMLButtonElement),
    reset = element('attachment-reset', HTMLButtonElement);
  const history = element('attachment-history-rows', HTMLDivElement),
    more = element('attachment-history-more', HTMLButtonElement);
  let selected: Selection | undefined,
    generation = 0,
    busy = false,
    controller: AbortController | undefined;
  let pending: { file: File; key: string; id?: string; sha256?: string } | undefined;
  let next: number | null = null;
  const run = (work: () => Promise<void>) => {
    const currentGeneration = generation;
    void work().catch((error: unknown) => {
      if (currentGeneration === generation) feedback(status, errorKey(error), {}, 'error');
    });
  };
  function source() {
    const uploading = mode.value === 'upload';
    element('attachment-file-label', HTMLLabelElement).hidden = !uploading;
    element('attachment-id-label', HTMLLabelElement).hidden = uploading;
    file.required = uploading;
    target.required = !uploading;
  }
  mode.onchange = source;
  file.onchange = () => {
    pending = undefined;
    element('attachment-upload-id', HTMLInputElement).value = '';
    if (file.files?.[0]) name.value = file.files[0].name;
  };
  function controls() {
    fields.disabled = busy || !selected?.canWrite;
    element('attachment-submit', HTMLButtonElement).disabled =
      busy || !selected?.canWrite || selected.current.items.length >= 32;
    pause.disabled = !controller;
    reset.disabled = busy;
    element('attachment-reload', HTMLButtonElement).disabled = busy || !selected;
    form.hidden = !selected?.canWrite;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-attachment-mutation]'))
      button.disabled = busy || !selected?.canWrite;
  }
  function fileRow(item: BuildAttachmentResponse, selection: Selection, remove: boolean) {
    const row = document.createElement('div');
    row.className = 'attachment-row';
    const details = document.createElement('div'),
      title = document.createElement('strong'),
      badge = document.createElement('span'),
      hint = document.createElement('p');
    title.textContent = item.name;
    title.id = `attachment-name-${crypto.randomUUID()}`;
    badge.className = 'attachment-kind';
    message(badge, kindMessages[item.kind]);
    hint.className = 'hint';
    hint.textContent = item.description;
    details.append(title, badge, hint);
    const actions = document.createElement('div');
    actions.className = 'button-row';
    if (selection.canDownload) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary small';
      message(button, 'download');
      button.setAttribute('aria-describedby', title.id);
      button.onclick = () => {
        run(() => download(selection.repository, item.artifactId, item.name));
      };
      actions.append(button);
    }
    if (remove && selection.canWrite) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost small';
      button.dataset['attachmentMutation'] = '';
      message(button, 'attachmentUnlink');
      button.setAttribute('aria-describedby', title.id);
      button.onclick = () => {
        run(async () => {
          await replace(
            selection,
            selection.current.items.filter((entry) => entry.name !== item.name),
          );
          element('attachment-reload', HTMLButtonElement).focus();
        });
      };
      actions.append(button);
    }
    row.append(details, actions);
    return row;
  }
  function render(selection: Selection) {
    list.replaceChildren(...selection.current.items.map((item) => fileRow(item, selection, true)));
    element('attachment-empty', HTMLParagraphElement).hidden = selection.current.items.length > 0;
    message(element('attachment-count', HTMLSpanElement), 'attachmentCount', {
      count: selection.current.items.length,
      revision: selection.current.revision,
    });
    controls();
  }
  async function replace(selection: Selection, items: readonly BuildAttachmentResponse[]) {
    if (busy || selected !== selection) return;
    busy = true;
    controls();
    try {
      const updated = await client.replaceAttachments(
        selection.repository,
        selection.id,
        selection.current.revision,
        items,
      );
      if (selected !== selection) return;
      selection.current = updated;
      render(selection);
      history.replaceChildren();
      next = null;
      more.disabled = true;
      feedback(status, 'attachmentSaved', { revision: updated.revision }, 'success');
    } finally {
      if (selected === selection) {
        busy = false;
        controls();
      }
    }
  }
  async function loadHistory(before?: number) {
    const selection = selected;
    if (!selection) return;
    more.disabled = true;
    const page = await client.attachmentHistory(selection.repository, selection.id, before);
    if (selected !== selection) return;
    if (before === undefined) history.replaceChildren();
    for (const revision of page.items) {
      const block = document.createElement('div');
      block.className = 'attachment-history-entry';
      const heading = document.createElement('p'),
        date = document.createElement('time'),
        actor = document.createElement('span');
      message(heading, 'revisionStatus', { revision: revision.revision });
      if (revision.createdAt) dateMessage(date, revision.createdAt);
      actor.textContent = revision.actor;
      block.append(heading, date, actor);
      for (const item of revision.items) block.append(fileRow(item, selection, false));
      if (selection.canWrite && revision.revision !== selection.current.revision) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary small';
        button.dataset['attachmentMutation'] = '';
        message(button, 'attachmentRestore');
        button.onclick = () => {
          run(async () => {
            await replace(selection, revision.items);
            element('attachment-history-load', HTMLButtonElement).focus();
          });
        };
        block.append(button);
      }
      history.append(block);
    }
    if (!page.items.length && before === undefined) {
      const empty = document.createElement('p');
      message(empty, 'attachmentHistoryEmpty');
      history.append(empty);
    }
    next = page.next;
    more.disabled = next === null;
    controls();
  }
  element('attachment-history-load', HTMLButtonElement).onclick = () => {
    run(() => loadHistory());
  };
  more.onclick = () => {
    run(() => loadHistory(next ?? undefined));
  };
  element('attachment-reload', HTMLButtonElement).onclick = () => {
    run(async () => {
      const selection = selected;
      if (!selection || busy) return;
      const current = await client.attachments(selection.repository, selection.id);
      if (selected === selection) {
        selection.current = current;
        render(selection);
        feedback(status, 'attachmentReloaded');
      }
    });
  };
  pause.onclick = () => controller?.abort();
  function resetDraft() {
    pending = undefined;
    form.reset();
    mode.value = selected?.canUpload ? 'upload' : 'existing';
    element('attachment-upload-id', HTMLInputElement).value = '';
    progress.value = 0;
    source();
  }
  reset.onclick = () => {
    if (!busy) resetDraft();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const selection = selected;
      if (!selection || busy) return;
      if (!selection.canWrite || selection.current.items.length >= 32)
        throw new UiError('errorInput');
      const attachmentKind = kind.value;
      if (
        attachmentKind !== 'manifest' &&
        attachmentKind !== 'sbom' &&
        attachmentKind !== 'signature' &&
        attachmentKind !== 'report' &&
        attachmentKind !== 'file'
      )
        throw new UiError('errorInput');
      const entryName = name.value.trim();
      if (
        selection.current.items.some((item) => item.name.toLowerCase() === entryName.toLowerCase())
      )
        throw new UiError('attachmentDuplicate');
      let artifactId = target.value.trim();
      if (mode.value === 'upload') {
        const current = file.files?.[0];
        if (!current) throw new UiError('chooseFileError');
        if (current.size > 5 * 1024 ** 3) throw new UiError('fileTooLarge');
        if (!selection.canUpload) throw new UiError('errorForbidden');
        pending ??= { file: current, key: crypto.randomUUID() };
        const attempt = pending;
        controller = new AbortController();
        const signal = controller.signal;
        busy = true;
        progress.max = Math.max(1, current.size);
        controls();
        try {
          if (!attempt.sha256) {
            feedback(status, 'hashing');
            attempt.sha256 = await hashFile(attempt.file, signal, (bytes) => {
              if (selected === selection) progress.value = bytes;
            });
          }
          if (!attempt.id) {
            const upload = await client.create(
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
            attempt.id = upload.id;
            if (selected === selection)
              element('attachment-upload-id', HTMLInputElement).value = upload.id;
          }
          await client.resume(selection.repository, attempt.id, attempt.file, {
            signal,
            onProgress: (bytes) => {
              if (selected === selection) {
                progress.value = bytes;
                feedback(status, 'uploading', {
                  percent: Math.round((bytes / Math.max(1, current.size)) * 100),
                });
              }
            },
          });
          artifactId = attempt.id;
        } finally {
          if (selected === selection) {
            busy = false;
            controller = undefined;
            controls();
          }
        }
      }
      if (selected !== selection) return;
      await replace(selection, [
        ...selection.current.items,
        { name: entryName, kind: attachmentKind, artifactId, description: description.value },
      ]);
      if (selected === selection) {
        resetDraft();
        name.focus();
      }
    });
  };
  return {
    clear() {
      generation++;
      controller?.abort();
      controller = undefined;
      busy = false;
      selected = undefined;
      panel.hidden = true;
      list.replaceChildren();
      history.replaceChildren();
      resetDraft();
      status.textContent = '';
      delete status.dataset['i18n'];
      controls();
    },
    async open(repository: string, id: string, operations: ReadonlySet<string>) {
      const request = ++generation;
      panel.hidden = true;
      const current = await client.attachments(repository, id);
      if (request !== generation) return;
      selected = {
        repository,
        id,
        current,
        canWrite: operations.has('replaceBuildAttachments'),
        canUpload: [
          'createUpload',
          'putUploadPart',
          'completeUpload',
          'getUpload',
          'listUploadParts',
        ].every((operation) => operations.has(operation)),
        canDownload: operations.has('downloadArtifact'),
      };
      const uploadOption = mode.querySelector<HTMLOptionElement>('option[value=upload]');
      if (uploadOption) uploadOption.disabled = !selected.canUpload;
      mode.value = selected.canUpload ? 'upload' : 'existing';
      source();
      panel.hidden = false;
      render(selected);
    },
  };
}

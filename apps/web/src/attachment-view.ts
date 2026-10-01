import type {
  AttachmentRevisionResponse,
  BuildAttachmentResponse,
} from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { dateMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';

const kindMessages: Record<BuildAttachmentResponse['kind'], MessageKey> = {
  manifest: 'attachmentManifest',
  sbom: 'attachmentSbom',
  signature: 'attachmentSignature',
  report: 'attachmentReport',
  file: 'attachmentFile',
};

const kinds = ['manifest', 'sbom', 'signature', 'report', 'file'] as const;
export function attachmentKind(value: string): BuildAttachmentResponse['kind'] | undefined {
  return kinds.find((kind) => kind === value);
}

export interface Selection {
  repository: string;
  id: string;
  current: AttachmentRevisionResponse;
  canWrite: boolean;
  canUpload: boolean;
  canDownload: boolean;
}

export interface RowActions {
  download: (selection: Selection, item: BuildAttachmentResponse) => void;
  unlink: (selection: Selection, item: BuildAttachmentResponse) => void;
  restore: (selection: Selection, revision: AttachmentRevisionResponse) => void;
}

export function attachmentElements() {
  return {
    panel: element('build-attachments', HTMLElement),
    list: element('attachment-list', HTMLDivElement),
    form: element('attachment-form', HTMLFormElement),
    fields: element('attachment-fields', HTMLFieldSetElement),
    file: element('attachment-file', HTMLInputElement),
    mode: element('attachment-source', HTMLSelectElement),
    name: element('attachment-name', HTMLInputElement),
    target: element('attachment-id', HTMLInputElement),
    kind: element('attachment-kind', HTMLSelectElement),
    description: element('attachment-description', HTMLInputElement),
    status: element('attachment-status', HTMLOutputElement),
    progress: element('attachment-progress', HTMLProgressElement),
    pause: element('attachment-pause', HTMLButtonElement),
    reset: element('attachment-reset', HTMLButtonElement),
    history: element('attachment-history-rows', HTMLDivElement),
    more: element('attachment-history-more', HTMLButtonElement),
    reload: element('attachment-reload', HTMLButtonElement),
    submit: element('attachment-submit', HTMLButtonElement),
    uploadId: element('attachment-upload-id', HTMLInputElement),
    historyLoad: element('attachment-history-load', HTMLButtonElement),
    fileLabel: element('attachment-file-label', HTMLLabelElement),
    idLabel: element('attachment-id-label', HTMLLabelElement),
    empty: element('attachment-empty', HTMLParagraphElement),
    count: element('attachment-count', HTMLSpanElement),
  };
}
export type AttachmentElements = ReturnType<typeof attachmentElements>;

function rowButton(key: MessageKey, className: string, describedBy: string, onclick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  message(button, key);
  button.setAttribute('aria-describedby', describedBy);
  button.onclick = onclick;
  return button;
}

export function fileRow(
  item: BuildAttachmentResponse,
  selection: Selection,
  actions: RowActions,
  removable: boolean,
) {
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
  const buttons = document.createElement('div');
  buttons.className = 'button-row';
  if (selection.canDownload)
    buttons.append(
      rowButton('download', 'secondary small', title.id, () => {
        actions.download(selection, item);
      }),
    );
  if (removable && selection.canWrite) {
    const unlink = rowButton('attachmentUnlink', 'ghost small', title.id, () => {
      actions.unlink(selection, item);
    });
    unlink.dataset['attachmentMutation'] = '';
    buttons.append(unlink);
  }
  row.append(details, buttons);
  return row;
}

export function historyEntry(
  revision: AttachmentRevisionResponse,
  selection: Selection,
  actions: RowActions,
) {
  const block = document.createElement('div');
  block.className = 'attachment-history-entry';
  const heading = document.createElement('p'),
    date = document.createElement('time'),
    actor = document.createElement('span');
  message(heading, 'attachmentVersion', { revision: revision.revision });
  if (revision.createdAt) dateMessage(date, revision.createdAt);
  actor.textContent = revision.actor;
  block.append(heading, date, actor);
  for (const item of revision.items) block.append(fileRow(item, selection, actions, false));
  if (selection.canWrite && revision.revision !== selection.current.revision) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    button.dataset['attachmentMutation'] = '';
    message(button, 'attachmentRestore');
    button.onclick = () => {
      actions.restore(selection, revision);
    };
    block.append(button);
  }
  return block;
}

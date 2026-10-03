import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { feedbackImageTypes, feedbackLimits } from '@proanima/arkvory-contracts';
import type { FeedbackImageType, FeedbackScreenshot } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, t } from './i18n.js';
import type { MessageKey } from './messages.js';
import { feedback, showFailure } from './feedback.js';
import { clientLogCount, clientLogText } from './client-log.js';

interface Shot {
  readonly file: File;
  readonly type: FeedbackImageType;
  readonly url: string;
}
const previewLines = 400;
const imageType = (file: File) => feedbackImageTypes.find((type) => type === file.type);

/** Base64 without a data: URL round trip; chunks keep the argument list of fromCharCode short. */
async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function nodes() {
  return {
    dialog: element('report-dialog', HTMLDialogElement),
    form: element('report-form', HTMLFormElement),
    message: element('report-message', HTMLTextAreaElement),
    email: element('report-email', HTMLInputElement),
    files: element('report-files', HTMLInputElement),
    drop: element('report-drop', HTMLElement),
    list: element('report-shots', HTMLUListElement),
    clientLog: element('report-client-log', HTMLInputElement),
    clientLabel: element('report-client-label', HTMLElement),
    serverField: element('report-server-field', HTMLElement),
    serverLog: element('report-server-log', HTMLInputElement),
    preview: element('report-preview', HTMLDetailsElement),
    previewNote: element('report-preview-note', HTMLElement),
    previewText: element('report-preview-text', HTMLElement),
    status: element('report-status', HTMLOutputElement),
    send: element('report-send', HTMLButtonElement),
    cancel: element('report-cancel', HTMLButtonElement),
    open: element('report-open', HTMLButtonElement),
  };
}
type Nodes = ReturnType<typeof nodes>;
const fail = (v: Nodes, key: MessageKey, params: Record<string, string> = {}) => {
  feedback(v.status, key, params, 'error');
};

/** The chosen images: thumbnails from object URLs, released when removed or sent. */
function screenshots(v: Nodes) {
  let shots: Shot[] = [];
  const render = () => {
    v.list.replaceChildren(...shots.map(item));
  };
  const item = (shot: Shot) => {
    const row = document.createElement('li');
    const image = document.createElement('img');
    image.src = shot.url;
    image.alt = shot.file.name;
    const name = document.createElement('span');
    message(name, 'reportShot', { name: shot.file.name, size: shot.file.size }, ['size']);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary small';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t('reportRemove', { name: shot.file.name }));
    remove.onclick = () => {
      URL.revokeObjectURL(shot.url);
      shots = shots.filter((other) => other !== shot);
      render();
      v.drop.focus();
    };
    row.append(image, name, remove);
    return row;
  };
  return {
    get items(): readonly Shot[] {
      return shots;
    },
    add(files: Iterable<File>) {
      for (const file of files) {
        const type = imageType(file);
        const refusal: MessageKey | null = !type
          ? 'reportFileType'
          : file.size > feedbackLimits.screenshotBytes
            ? 'reportFileTooLarge'
            : shots.length === feedbackLimits.screenshots
              ? 'reportTooMany'
              : null;
        if (refusal || !type) {
          fail(v, refusal ?? 'reportFileType', { name: file.name });
          return;
        }
        shots.push({ file, type, url: URL.createObjectURL(file) });
      }
      v.status.replaceChildren();
      render();
    },
    clear() {
      for (const shot of shots) URL.revokeObjectURL(shot.url);
      shots = [];
      render();
    },
  };
}
type Screenshots = ReturnType<typeof screenshots>;

/** Images arrive by drop, by the picker, or pasted (PrintScreen, then Ctrl+V). */
function bindSources(v: Nodes, shots: Screenshots) {
  v.drop.tabIndex = 0;
  v.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  v.drop.addEventListener('drop', (event) => {
    event.preventDefault();
    shots.add(event.dataTransfer?.files ?? []);
  });
  // Text pastes go to the fields as usual; only images become attachments.
  v.dialog.addEventListener('paste', (event) => {
    const images = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
      .map((file, index) => {
        const generic = !file.name || file.name === 'image.png';
        const name = generic
          ? `screenshot-${String(Date.now())}-${String(index + 1)}.png`
          : file.name;
        return new File([file], name, { type: file.type });
      });
    if (!images.length) return;
    event.preventDefault();
    shots.add(images);
  });
  element('report-pick', HTMLButtonElement).onclick = () => {
    v.files.click();
  };
  v.files.onchange = () => {
    shots.add(v.files.files ?? []);
    v.files.value = '';
  };
}

/** One message per click: a failed send leaves the form as it was, nothing is retried. */
async function submit(client: ArkvoryClient, v: Nodes, shots: Screenshots, admin: boolean) {
  const text = v.message.value.trim();
  if (!text) {
    fail(v, 'reportMessageRequired');
    return;
  }
  if (v.email.value && !v.email.checkValidity()) {
    fail(v, 'reportEmailInvalid');
    return;
  }
  const serverLog = admin && v.serverLog.checked;
  const clientLog = v.clientLog.checked ? clientLogText() : null;
  const total =
    shots.items.reduce((sum, shot) => sum + shot.file.size, 0) +
    new Blob([text, clientLog ?? '']).size +
    (serverLog ? 2 * feedbackLimits.logBytes : 0);
  if (total > feedbackLimits.totalBytes) {
    fail(v, 'reportTooLarge');
    return;
  }
  v.send.disabled = true;
  feedback(v.status, 'reportSending');
  try {
    const images: FeedbackScreenshot[] = await Promise.all(
      shots.items.map(async (shot) => ({
        name: shot.file.name,
        type: shot.type,
        data: await base64(shot.file),
      })),
    );
    const receipt = await client.feedback.send({
      message: text,
      email: v.email.value.trim() || null,
      lang: document.documentElement.lang === 'en' ? 'en' : 'ru',
      screen: `${String(innerWidth)}x${String(innerHeight)}`,
      screenshots: images,
      clientLog,
      serverLog,
    });
    shots.clear();
    v.message.value = '';
    feedback(v.status, 'reportSent', { id: receipt.id }, 'success');
    message(v.cancel, 'reportClose');
  } catch (error) {
    showFailure(v.status, error);
  } finally {
    v.send.disabled = false;
  }
}

/** What will be attached, as the hub receives it; the server part only for administrators. */
async function showPreview(client: ArkvoryClient, v: Nodes, admin: boolean) {
  const parts = [v.clientLog.checked ? clientLogText() : ''];
  message(v.previewNote, 'reportLoading');
  if (admin && v.serverLog.checked) {
    try {
      const attached = await client.feedback.attachments();
      const lines = attached.serverLog.split('\n');
      parts.push(attached.system, lines.slice(-previewLines).join('\n'));
      message(v.previewNote, 'reportTail', { count: Math.min(lines.length, previewLines) });
    } catch (error) {
      showFailure(v.previewNote, error);
    }
  } else v.previewNote.replaceChildren();
  v.previewText.textContent = parts.filter(Boolean).join('\n');
}

/**
 * Feedback to ProAnimaStudio (ADR 0060): text, screenshots (pasted, dropped or chosen) and the
 * logs this form shows. The server adds its own log only for administrators who keep it ticked.
 */
export function installReportDialog(client: ArkvoryClient) {
  const v = nodes();
  const shots = screenshots(v);
  let administrator = false;
  let busy = false;
  bindSources(v, shots);
  v.preview.addEventListener('toggle', () => {
    if (v.preview.open) void showPreview(client, v, administrator);
  });
  v.open.onclick = () => {
    message(v.clientLabel, 'reportClientLog', { count: clientLogCount() });
    v.serverField.hidden = !administrator;
    v.dialog.showModal();
    v.message.focus();
  };
  v.cancel.onclick = () => {
    v.dialog.close();
  };
  v.dialog.addEventListener('close', () => {
    if (busy) return;
    shots.clear();
    v.form.reset();
    v.preview.open = false;
    v.status.replaceChildren();
    message(v.cancel, 'confirmCancel');
  });
  v.form.onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    void submit(client, v, shots, administrator).finally(() => {
      busy = false;
    });
  };
  return {
    /** Signed in: the form becomes available; administrators may attach the server log. */
    connect(admin: boolean) {
      administrator = admin;
      v.open.hidden = false;
    },
    /** Signed out or another key: no form, no administrator attachments. */
    clear() {
      administrator = false;
      v.open.hidden = true;
      if (v.dialog.open) v.dialog.close();
    },
  };
}

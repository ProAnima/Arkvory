import { DepotClient, DepotHttpError } from '@proanima/depot-sdk';
import { record, text, stringMap } from '@proanima/depot-contracts';
import { element } from './dom.js';
import { installAssetHistory } from './asset-history.js';
import { message } from './i18n.js';
import { feedback, UiError, errorKey } from './feedback.js';
import { initializeShell, showView } from './shell.js';
import { installPackageView } from './packages.js';
import { installAdministration } from './administration.js';
declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName: string;
    }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
  }
}

const token = element('token', HTMLInputElement),
  repository = element('repository', HTMLInputElement),
  output = element('status', HTMLOutputElement),
  rows = element('artifacts', HTMLTableSectionElement),
  uploadId = element('upload-id', HTMLInputElement),
  progress = element('progress', HTMLProgressElement);
const client = new DepotClient(location.origin, () => token.value);
initializeShell();
let stop: AbortController | undefined;
let selected: { repository: string; id: string; revision: number; name: string } | undefined;
let selectionGeneration = 0;
let listGeneration = 0;
const transferStatus = element('transfer-status', HTMLOutputElement);
const run = (action: () => Promise<void>) => {
  const requestId = element('request-id', HTMLSpanElement);
  requestId.textContent = '';
  delete requestId.dataset['i18n'];
  void action().catch((error: unknown) => {
    feedback(output, errorKey(error), {}, 'error');
    if (error instanceof DepotHttpError && error.requestId)
      message(requestId, 'requestId', { id: error.requestId });
  });
};
function connection(connected: boolean) {
  const state = element('connection-state', HTMLSpanElement);
  state.dataset['connected'] = String(connected);
  message(state, connected ? 'connected' : 'disconnected');
}
async function openArtifact(repo: string, id: string, name: string) {
  const generation = ++selectionGeneration;
  const a = await client.annotations(repo, id);
  if (generation !== selectionGeneration || repo !== repository.value) return;
  selected = { repository: repo, id, revision: a.revision, name };
  element('selected', HTMLInputElement).value = id;
  element('labels', HTMLInputElement).value = a.labels.join(', ');
  element('collections', HTMLInputElement).value = a.collections.join(', ');
  element('metadata', HTMLTextAreaElement).value = JSON.stringify(a.metadata, null, 2);
  element('editor', HTMLDivElement).hidden = false;
  element('editor-empty', HTMLDivElement).hidden = true;
  showView('metadata');
  feedback(output, 'revisionStatus', { revision: a.revision });
}
function clearSelection() {
  selectionGeneration++;
  selected = undefined;
  for (const id of ['selected', 'labels', 'collections']) element(id, HTMLInputElement).value = '';
  element('metadata', HTMLTextAreaElement).value = '{}';
  element('editor', HTMLDivElement).hidden = true;
  element('editor-empty', HTMLDivElement).hidden = false;
}
function clearCatalog() {
  listGeneration++;
  rows.replaceChildren();
  element('more', HTMLButtonElement).disabled = true;
  element('catalog-empty', HTMLDivElement).hidden = false;
  message(element('catalog-count', HTMLSpanElement), 'loaded', { count: 0 });
  message(element('empty-title', HTMLHeadingElement), 'emptyTitle');
  message(element('empty-description', HTMLParagraphElement), 'emptyDescription');
  connection(false);
  clearSelection();
  clearPackages();
  administration.clear();
  element('change-password', HTMLFormElement).hidden = true;
  if (!element('administration-panel', HTMLElement).hidden) showView('catalog');
}
for (const input of [repository, token]) input.addEventListener('input', clearCatalog);
const resetHistory = installAssetHistory(client, repository, token, openArtifact, run);
const clearPackages = installPackageView(client, repository, token, run, async (id) => {
  const repo = repository.value;
  const artifact = await client.artifact(repo, id);
  await openArtifact(repo, id, artifact.descriptor.name);
});
const administration = installAdministration(client, run);
function hashFile(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/console/hash-worker.js', { type: 'module' });
    const done = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      done();
      reject(new UiError('paused'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onerror = () => {
      done();
      reject(new UiError('hashError'));
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const value = record(event.data);
        if (typeof value['sha256'] === 'string') {
          done();
          resolve(value['sha256']);
        } else if (typeof value['bytes'] === 'number') {
          progress.value = value['bytes'];
          feedback(transferStatus, 'hashing');
        } else if (value['error']) {
          done();
          reject(new UiError('hashError'));
        }
      } catch (error) {
        done();
        reject(error instanceof UiError ? error : new UiError('hashError'));
      }
    };
    worker.postMessage(file);
  });
}
async function list(after?: string) {
  const generation = ++listGeneration;
  const repo = repository.value;
  feedback(output, 'searching');
  const page = await client.search(repo, {
    q: element('query', HTMLInputElement).value,
    label: element('filter-label', HTMLInputElement).value,
    ...(after ? { after } : {}),
  });
  if (generation !== listGeneration) return;
  connection(true);
  if (!after) rows.replaceChildren();
  for (const item of page.items) {
    const row = document.createElement('tr'),
      name = document.createElement('td'),
      id = document.createElement('td'),
      actions = document.createElement('td');
    name.textContent = item.name;
    id.textContent = item.id;
    id.className = 'artifact-id';
    const button = document.createElement('button');
    message(button, 'open');
    button.className = 'secondary small';
    button.onclick = () => {
      run(() => openArtifact(repo, item.id, item.name));
    };
    actions.append(button);
    row.append(name, id, actions);
    rows.append(row);
  }
  const more = element('more', HTMLButtonElement);
  more.disabled = page.next === null;
  more.onclick = () => {
    if (page.next) run(() => list(page.next ?? undefined));
  };
  element('catalog-empty', HTMLDivElement).hidden = rows.rows.length > 0;
  message(element('empty-title', HTMLHeadingElement), 'noResultsTitle');
  message(element('empty-description', HTMLParagraphElement), 'noResults');
  message(element('catalog-count', HTMLSpanElement), 'loaded', { count: rows.rows.length });
  feedback(output, 'loaded', { count: rows.rows.length });
}
element('connect', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const me = await client.me();
    if (me.administrator) administration.show();
    element('change-password', HTMLFormElement).hidden = !me.id.startsWith('user:');
    await list();
  });
};
element('login', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const name = element('login-name', HTMLInputElement).value;
    const session = await client.login(name, element('login-password', HTMLInputElement).value);
    token.value = session.token;
    element('login-password', HTMLInputElement).value = '';
    clearCatalog();
    element('change-password', HTMLFormElement).hidden = false;
    if (session.account.administrator) {
      administration.show();
      showView('administration');
      await administration.refresh();
    } else await list();
    feedback(output, 'signedIn', { name: session.account.name }, 'success');
  });
};
element('change-password', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const current = element('current-password', HTMLInputElement);
    const next = element('own-new-password', HTMLInputElement);
    await client.changePassword(current.value, next.value);
    current.value = '';
    next.value = '';
    token.value = '';
    clearCatalog();
    resetHistory();
    feedback(output, 'passwordChangedSignIn', {}, 'success');
  });
};
element('search', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(() => list());
};
element('logout', HTMLButtonElement).onclick = () => {
  stop?.abort();
  run(async () => {
    try {
      if (token.value) await client.logout();
    } finally {
      token.value = '';
      clearCatalog();
      resetHistory();
      feedback(output, 'disconnected');
    }
  });
};
element('cancel', HTMLButtonElement).onclick = () => stop?.abort();
element('upload', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (stop) throw new UiError('uploadRunning');
    const file = element('file', HTMLInputElement).files?.[0];
    if (!file) throw new UiError('chooseFileError');
    if (file.size > 5 * 1024 ** 3) throw new UiError('fileTooLarge');
    const repo = repository.value;
    stop = new AbortController();
    element('connection-fields', HTMLFieldSetElement).disabled = true;
    element('upload-submit', HTMLButtonElement).disabled = true;
    element('cancel', HTMLButtonElement).disabled = false;
    for (const id of ['file', 'upload-id', 'idempotency'])
      element(id, HTMLInputElement).disabled = true;
    element('new-upload', HTMLButtonElement).disabled = true;
    progress.max = Math.max(1, file.size);
    progress.value = 0;
    try {
      if (!uploadId.value) {
        const sha256 = await hashFile(file, stop.signal);
        const key = element('idempotency', HTMLInputElement);
        if (!key.value) key.value = crypto.randomUUID();
        const upload = await client.create(
          repo,
          key.value,
          { name: file.name, size: String(file.size), sha256, labels: [], metadata: {} },
          stop.signal,
        );
        uploadId.value = upload.id;
      }
      const result = await client.resume(repo, uploadId.value, file, {
        signal: stop.signal,
        onProgress: (bytes) => {
          progress.value = bytes;
          feedback(transferStatus, 'uploading', { percent: Math.round((bytes / file.size) * 100) });
        },
      });
      progress.value = progress.max;
      feedback(transferStatus, 'published', { id: result.id }, 'success');
      try {
        await list();
        feedback(output, 'published', { id: result.id }, 'success');
      } catch {
        feedback(output, 'publishedRefresh');
      }
    } catch (error) {
      const failure = stop.signal.aborted ? new UiError('paused') : error;
      feedback(transferStatus, errorKey(failure), {}, 'error');
      throw failure;
    } finally {
      stop = undefined;
      element('connection-fields', HTMLFieldSetElement).disabled = false;
      element('upload-submit', HTMLButtonElement).disabled = false;
      element('cancel', HTMLButtonElement).disabled = true;
      for (const id of ['file', 'upload-id', 'idempotency'])
        element(id, HTMLInputElement).disabled = false;
      element('new-upload', HTMLButtonElement).disabled = false;
    }
  });
};
element('new-upload', HTMLButtonElement).onclick = () => {
  if (!stop) {
    uploadId.value = '';
    element('idempotency', HTMLInputElement).value = '';
    progress.value = 0;
    feedback(transferStatus, 'transferIdle');
  }
};
element('edit', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (!selected) throw new UiError('selectError');
    const artifact = selected;
    const split = (id: string) =>
      element(id, HTMLInputElement)
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    let metadata: Readonly<Record<string, string>>;
    try {
      const raw: unknown = JSON.parse(element('metadata', HTMLTextAreaElement).value);
      metadata = stringMap(raw);
    } catch {
      throw new UiError('jsonError');
    }
    const next = await client.annotate(artifact.repository, artifact.id, artifact.revision, {
      labels: split('labels'),
      collections: split('collections'),
      metadata,
    });
    if (selected !== artifact) return;
    artifact.revision = next.revision;
    feedback(output, 'saved', { revision: next.revision }, 'success');
  });
};
element('register-package', HTMLButtonElement).onclick = () => {
  run(async () => {
    if (!selected) throw new UiError('selectError');
    const value = await client.registerPackage(selected.repository, selected.id);
    feedback(
      output,
      'registered',
      { name: text(value['name']), version: text(value['version']) },
      'success',
    );
  });
};
element('download', HTMLButtonElement).onclick = () => {
  run(async () => {
    if (!selected) throw new UiError('selectError');
    if (!window.showSaveFilePicker) throw new UiError('saveUnsupported');
    const artifact = { ...selected };
    const repo = artifact.repository;
    const handle = await window.showSaveFilePicker({ suggestedName: artifact.name });
    const stream = await client.downloadVerified(repo, artifact.id);
    let target: WritableStream<Uint8Array>;
    try {
      target = await handle.createWritable();
    } catch (error) {
      await stream.cancel();
      throw error;
    }
    await stream.pipeTo(target);
    feedback(output, 'downloaded', {}, 'success');
  });
};
element('asset', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (!selected) throw new UiError('selectError');
    const result = await client.setAsset(
      selected.repository,
      element('asset-path', HTMLInputElement).value,
      selected.id,
      Number(element('asset-revision', HTMLInputElement).value),
    );
    element('asset-revision', HTMLInputElement).value = String(result.revision);
    feedback(output, 'assigned', { revision: result.revision }, 'success');
  });
};

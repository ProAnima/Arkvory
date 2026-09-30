import { installCatalogFilter, catalogFilter } from './catalog-filter.js';
import { consoleRunner } from './console-runner.js';
import { ManagementConsole } from './management.js';
import { installRepositoryStorage } from './repository-storage.js';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { text } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { installAssetHistory } from './asset-history.js';
import { message } from './i18n.js';
import { feedback, UiError, errorKey } from './feedback.js';
import { initializeShell, showView } from './shell.js';
import { installPackageView } from './packages.js';
import { installAdministration } from './administration.js';
import { hashFile } from './file-hash.js';
import { installAnnotationEditor } from './annotation-editor.js';
import { installBuildAttachments } from './build-attachments.js';
import { installArtifactDeletion } from './artifact-deletion.js';
import { installDownloads } from './downloads.js';
import { installUpdates } from './updates.js';
import { installUploadControls } from './upload-controls.js';
import { installUserTokens } from './user-tokens.js';
import { installAuthConsole } from './auth-console.js';
const token = element('token', HTMLInputElement),
  repository = element('repository', HTMLInputElement),
  output = element('status', HTMLOutputElement),
  rows = element('artifacts', HTMLTableSectionElement),
  uploadId = element('upload-id', HTMLInputElement),
  progress = element('progress', HTMLProgressElement);
const apiBaseUrl =
  document.querySelector<HTMLMetaElement>('meta[name="arkvory-api-base-url"]')?.content.trim() ||
  location.origin;
initializeShell();
let client: ArkvoryClient;
try {
  client = new ArkvoryClient(apiBaseUrl, () => token.value);
} catch {
  feedback(output, 'apiAddressError', {}, 'error');
  throw new Error('Invalid Arkvory API base URL');
}
const management = new ManagementConsole(apiBaseUrl, token, (id, storage) => {
  if (stop) return;
  run(async () => {
    const administrator = !element('admin-nav', HTMLButtonElement).hidden;
    const identity = token.value;
    repository.value = id;
    repository.dispatchEvent(new Event('input', { bubbles: true }));
    await repositoryStorage.connect(id);
    if (token.value !== identity || repository.value !== id) return;
    connection(true);
    showView('catalog');
    if (storage) element('storage-panel', HTMLDetailsElement).open = true;
    else await list();
    if (token.value !== identity || repository.value !== id) return;
    if (administrator) administration.show();
    updates.connect(administrator);
    void management.connect();
  });
});
const repositoryStorage = installRepositoryStorage(client);
const updates = installUpdates(client);
const downloads = installDownloads(apiBaseUrl, token);
const annotationEditor = installAnnotationEditor();
const attachments = installBuildAttachments(client, (repo, id, name) =>
  downloads.enqueue(repo, id, name),
);
const deletion = installArtifactDeletion(client, async () => {
  clearSelection();
  showView('catalog');
  try {
    await list();
    feedback(output, 'deletionDone', {}, 'success');
  } catch {
    feedback(output, 'deletionRefresh', {}, 'error');
  }
});
let stop: AbortController | undefined;
const uploadBusy = installUploadControls(() => stop !== undefined || attachments.isUploading());
let selected: { repository: string; id: string; revision: number; name: string } | undefined;
let selectionGeneration = 0;
let listGeneration = 0;
const transferStatus = element('transfer-status', HTMLOutputElement);
let wasConnected = false;
let repositoryEdited = false;
let authenticationGeneration = 0;
const repositoryOptions = element('repository-options', HTMLElement);
const run = consoleRunner(output);
function connection(connected: boolean) {
  const state = element('connection-state', HTMLSpanElement);
  const details = element('connection-card', HTMLDetailsElement);
  const connectedRepository = element('connection-repository', HTMLSpanElement);
  state.dataset['connected'] = String(connected);
  message(state, connected ? 'connected' : 'disconnected');
  connectedRepository.hidden = !connected;
  connectedRepository.textContent = connected ? repository.value : '';
  if (connected && !wasConnected) details.open = false;
  if (!connected) details.open = true;
  wasConnected = connected;
  if (connected) void repositoryStorage.connect(repository.value);
  else repositoryStorage.clear();
}
async function openArtifact(repo: string, id: string, name: string) {
  clearSelection();
  const generation = ++selectionGeneration;
  const [a, page] = await Promise.all([
    client.annotations(repo, id),
    client.operations({ repository: repo, limit: 100 }),
  ]);
  const operations = new Set(page.items.map((operation) => operation.operationId));
  let after = page.next;
  while (after) {
    const next = await client.operations({ repository: repo, limit: 100, after });
    for (const operation of next.items) operations.add(operation.operationId);
    after = next.next;
  }
  if (generation !== selectionGeneration || repo !== repository.value) return;
  selected = { repository: repo, id, revision: a.revision, name };
  element('selected-name', HTMLParagraphElement).textContent = name;
  element('selected-name', HTMLParagraphElement).hidden = false;
  element('selected', HTMLInputElement).value = id;
  element('labels', HTMLInputElement).value = a.labels.join(', ');
  element('collections', HTMLInputElement).value = a.collections.join(', ');
  annotationEditor.set(a.metadata, operations.has('setAnnotations'));
  for (const id of ['labels', 'collections'])
    element(id, HTMLInputElement).disabled = !operations.has('setAnnotations');
  element('annotation-save', HTMLButtonElement).disabled = !operations.has('setAnnotations');
  element('download', HTMLButtonElement).hidden = !operations.has('downloadArtifact');
  element('register-package', HTMLButtonElement).hidden = !operations.has('registerPackage');
  element('asset', HTMLFormElement).hidden = !operations.has('setAsset');
  element('editor', HTMLDivElement).hidden = false;
  element('editor-empty', HTMLDivElement).hidden = true;
  showView('metadata');
  feedback(output, 'revisionStatus', { revision: a.revision });
  await attachments.open(repo, id, operations);
  if (generation === selectionGeneration) deletion.open(repo, id, operations.has('deleteArtifact'));
}
function clearSelection() {
  deletion.clear();
  attachments.clear();
  annotationEditor.set({}, false);
  selectionGeneration++;
  selected = undefined;
  element('selected-name', HTMLParagraphElement).textContent = '';
  element('selected-name', HTMLParagraphElement).hidden = true;
  for (const id of ['selected', 'labels', 'collections']) element(id, HTMLInputElement).value = '';
  element('metadata', HTMLTextAreaElement).value = '{}';
  element('editor', HTMLDivElement).hidden = true;
  element('editor-empty', HTMLDivElement).hidden = false;
}
function clearCatalog() {
  listGeneration++;
  element('catalog-panel', HTMLElement).removeAttribute('aria-busy');
  for (const button of element('search', HTMLFormElement).querySelectorAll<HTMLButtonElement>(
    'button[type="submit"], button:not([type])',
  ))
    button.disabled = false;
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
  updates.clear();
  management.clear();
  element('change-password', HTMLFormElement).hidden = true;
  if (!element('administration-panel', HTMLElement).hidden) showView('catalog');
}
repository.addEventListener('input', () => {
  repositoryEdited = true;
  clearCatalog();
});
token.addEventListener('input', () => {
  authenticationGeneration++;
  repositoryOptions.replaceChildren();
  clearCatalog();
});
const resetHistory = installAssetHistory(client, repository, token, openArtifact, run);
const clearPackages = installPackageView(client, repository, token, run, async (id) => {
  const repo = repository.value;
  const artifact = await client.artifact(repo, id);
  await openArtifact(repo, id, artifact.descriptor.name);
});
const administration = installAdministration(client, run);
const userTokens = installUserTokens(client, run);
async function list(after?: string) {
  const generation = ++listGeneration;
  const repo = repository.value;
  const panel = element('catalog-panel', HTMLElement);
  const searchButton = element('search', HTMLFormElement).querySelector<HTMLButtonElement>(
    'button:not([type])',
  );
  const moreButton = element('more', HTMLButtonElement);
  const wasDisabled = moreButton.disabled;
  panel.setAttribute('aria-busy', 'true');
  if (searchButton) searchButton.disabled = true;
  moreButton.disabled = true;
  feedback(output, 'searching');
  try {
    const page = await client.search(repo, {
      ...catalogFilter(),
      ...(after ? { after } : {}),
    });
    if (generation !== listGeneration) return;
    connection(true);
    if (!after) rows.replaceChildren();
    for (const item of page.items) {
      const row = document.createElement('tr'),
        name = document.createElement('td'),
        id = document.createElement('span'),
        actions = document.createElement('td');
      const filename = document.createElement('span');
      filename.textContent = item.name;
      filename.className = 'artifact-name';
      filename.id = `artifact-name-${item.id}`;
      id.textContent = item.id;
      id.className = 'artifact-id';
      name.append(filename, id);
      const button = document.createElement('button');
      message(button, 'open');
      button.className = 'secondary small';
      button.setAttribute('aria-describedby', filename.id);
      button.onclick = () => {
        run(() => openArtifact(repo, item.id, item.name));
      };
      const download = document.createElement('button');
      message(download, 'download');
      download.type = 'button';
      download.className = 'secondary small';
      download.setAttribute('aria-describedby', filename.id);
      download.onclick = () => {
        run(() => downloads.enqueue(repo, item.id, item.name));
      };
      const controls = document.createElement('div');
      controls.className = 'catalog-actions';
      controls.append(button, download);
      actions.append(controls);
      row.append(name, actions);
      rows.append(row);
    }
    const more = element('more', HTMLButtonElement);
    more.disabled = page.next === null;
    more.onclick = () => {
      if (page.next) run(() => list(page.next ?? undefined));
    };
    element('catalog-empty', HTMLDivElement).hidden = rows.rows.length > 0;
    const filtered = Object.values(catalogFilter()).some(Boolean);
    message(
      element('empty-title', HTMLHeadingElement),
      filtered ? 'noResultsTitle' : 'searchEmptyTitle',
    );
    message(
      element('empty-description', HTMLParagraphElement),
      filtered ? 'noResults' : 'searchEmpty',
    );
    message(element('catalog-count', HTMLSpanElement), 'loaded', { count: rows.rows.length });
    feedback(output, 'loaded', { count: rows.rows.length });
  } catch (error) {
    if (generation !== listGeneration) return;
    moreButton.disabled = wasDisabled;
    throw error;
  } finally {
    if (generation === listGeneration) {
      panel.removeAttribute('aria-busy');
      if (searchButton) searchButton.disabled = false;
    }
  }
}
installAuthConsole({
  client,
  token,
  repository,
  repositoryOptions,
  output,
  apiBaseUrl,
  run,
  list: () => list(),
  clearCatalog,
  resetHistory,
  downloads,
  administration,
  updates,
  management,
  userTokens,
  getGeneration: () => authenticationGeneration,
  nextGeneration: () => ++authenticationGeneration,
  isRepositoryEdited: () => repositoryEdited,
  setRepositoryEdited: (val) => {
    repositoryEdited = val;
  },
  getStopSignal: () => stop,
});
element('search', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(() => list());
};
installCatalogFilter(() => {
  run(() => list());
});
element('cancel', HTMLButtonElement).onclick = () => stop?.abort();
element('upload', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (stop) throw new UiError('uploadRunning');
    const file = element('file', HTMLInputElement).files?.[0];
    if (!file) throw new UiError('chooseFileError');
    if (file.size > 64 * 1024 ** 3) throw new UiError('fileTooLarge');
    const repo = repository.value;
    stop = new AbortController();
    uploadBusy(true);
    progress.max = Math.max(1, file.size);
    progress.value = 0;
    try {
      if (!uploadId.value) {
        const sha256 = await hashFile(file, stop.signal, (bytes) => {
          progress.value = bytes;
          feedback(transferStatus, 'hashing');
        });
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
      if (stop.signal.aborted) {
        feedback(transferStatus, 'paused');
        return;
      }
      feedback(transferStatus, errorKey(error), {}, 'error');
      throw error;
    } finally {
      stop = undefined;
      uploadBusy(false);
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
    const metadata = annotationEditor.read();
    const save = element('annotation-save', HTMLButtonElement);
    if (save.disabled) return;
    save.disabled = true;
    try {
      const next = await client.annotate(artifact.repository, artifact.id, artifact.revision, {
        labels: split('labels'),
        collections: split('collections'),
        metadata,
      });
      if (selected !== artifact) return;
      artifact.revision = next.revision;
      // Keep any new text entered while the request was in flight.
      feedback(output, 'saved', { revision: next.revision }, 'success');
    } finally {
      if (selected === artifact) save.disabled = false;
    }
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
    await downloads.enqueue(selected.repository, selected.id, selected.name);
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

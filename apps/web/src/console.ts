import { installCatalogFilter, catalogFilter } from './catalog-filter.js';
import { consoleRunner } from './console-runner.js';
import { ManagementConsole } from './management.js';
import { installRepositoryStorage } from './repository-storage.js';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { text } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { installAssetHistory } from './asset-history.js';
import { initializeLanguage, message } from './i18n.js';
import { feedback, quietFeedback, UiError } from './feedback.js';
import { initializeShell, setArtifactRoute, showView } from './shell.js';
import { installConnectionState } from './connection-state.js';
import { installDeepLinks } from './deep-links.js';
import { formatRoute } from './routes.js';
import { installPackageView } from './packages.js';
import { installAdministration } from './administration.js';
import { installAnnotationEditor } from './annotation-editor.js';
import { installBuildAttachments } from './build-attachments.js';
import { installArtifactDeletion } from './artifact-deletion.js';
import { installPromotionPanel } from './promotion-panel.js';
import { installArtifactSummary } from './artifact-summary.js';
import { installDownloads } from './downloads.js';
import { installUpdates } from './updates.js';
import { MirrorsPage } from './mirrors-page.js';
import { installBackups } from './backups.js';
import { installUploadForm } from './upload-form.js';
import { installUserTokens } from './user-tokens.js';
import { installAuthConsole } from './auth-console.js';
import { artifactRow } from './artifact-row.js';
import { withFieldErrors } from './field-errors.js';
import { installClientLog } from './client-log.js';
import { installReportDialog } from './report-dialog.js';
import { installDownloadLink } from './download-link.js';
// First: failures while the console starts belong in a feedback report as well.
installClientLog();
const token = element('token', HTMLInputElement),
  repository = element('repository', HTMLInputElement),
  output = element('status', HTMLOutputElement),
  rows = element('artifacts', HTMLTableSectionElement);
const apiBaseUrl =
  document.querySelector<HTMLMetaElement>('meta[name="arkvory-api-base-url"]')?.content.trim() ||
  location.origin;
// The page is shown in its language from the first paint: a fetched dictionary is awaited.
await initializeLanguage();
initializeShell();
let client: ArkvoryClient;
try {
  client = new ArkvoryClient(apiBaseUrl, () => token.value);
} catch {
  feedback(output, 'apiAddressError', {}, 'error');
  throw new Error('Invalid Arkvory API base URL');
}
/** Opens a repository in the catalog, from Repositories (or its storage) and from Mirrors. */
function openRepository(id: string, storage = false) {
  if (upload.running()) return;
  run(async () => {
    const administrator = !element('admin-nav', HTMLButtonElement).hidden;
    const identity = token.value;
    repository.value = id;
    repository.dispatchEvent(new Event('input', { bubbles: true }));
    await repositoryStorage.connect(id);
    if (token.value !== identity || repository.value !== id) return;
    state.repository(true);
    showView('catalog');
    if (storage) element('storage-panel', HTMLDetailsElement).open = true;
    else await list();
    if (token.value !== identity || repository.value !== id) return;
    if (administrator) administration.show();
    void connectSigned(administrator);
    void management.connect();
    void backups.connect();
  });
}
const management = new ManagementConsole(apiBaseUrl, token, openRepository);
const repositoryStorage = installRepositoryStorage(client);
const state = installConnectionState(repositoryStorage, repository);
const updates = installUpdates(client);
const mirrors = new MirrorsPage(client, (id) => {
  openRepository(id);
});
/** Screens that follow the signed-in role; settles once their navigation entries are known. */
async function connectSigned(administrator: boolean) {
  report.connect(administrator);
  await Promise.all([updates.connect(administrator), mirrors.connect(administrator)]);
}
const report = installReportDialog(client);
const downloadLink = installDownloadLink(client, () => selected);
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
let selected: { repository: string; id: string; revision: number; name: string } | undefined;
let selectionGeneration = 0;
let listGeneration = 0;
let repositoryEdited = false;
let authenticationGeneration = 0;
const repositoryOptions = element('repository-options', HTMLElement);
// Bound after sign-in handling is installed; only password sessions can expire in place.
let expireSession: (error: unknown) => boolean = () => false;
const run = consoleRunner(output, (error) => expireSession(error));
const upload = installUploadForm({
  client,
  repository,
  output,
  run,
  list: () => list(),
  busyElsewhere: () => attachments.isUploading(),
});
const backups = installBackups(apiBaseUrl, token, (error) => expireSession(error));
const summary = installArtifactSummary(client, output);
const promotion = installPromotionPanel(client, run, () => {
  clearSelection();
  showView('catalog');
  run(() => list());
});
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
  downloadLink.open(operations.has('createDownloadLink'));
  element('register-package', HTMLButtonElement).hidden = !operations.has('registerPackage');
  element('asset', HTMLFormElement).hidden = !operations.has('setAsset');
  element('editor', HTMLDivElement).hidden = false;
  element('editor-empty', HTMLDivElement).hidden = true;
  const route = formatRoute({ kind: 'artifact', repository: repo, id });
  setArtifactRoute(route);
  showView('metadata', { route });
  quietFeedback(output, 'revisionStatus', { revision: a.revision });
  promotion.open(repo, id, operations);
  await summary.open(repo, id);
  await attachments.open(repo, id, operations);
  if (generation === selectionGeneration) deletion.open(repo, id, operations.has('deleteArtifact'));
}
function clearSelection() {
  summary.clear();
  promotion.clear();
  deletion.clear();
  attachments.clear();
  annotationEditor.set({}, false);
  selectionGeneration++;
  selected = undefined;
  setArtifactRoute(undefined);
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
  state.repository(false);
  clearSelection();
  clearPackages();
  administration.clear();
  updates.clear();
  mirrors.clear();
  report.clear();
  management.clear();
  backups.clear();
  element('change-password', HTMLFormElement).hidden = true;
  if (!element('administration-panel', HTMLElement).hidden) showView('catalog');
}
repository.addEventListener('input', () => {
  repositoryEdited = true;
  clearCatalog();
});
token.addEventListener('input', () => {
  authenticationGeneration++;
  state.session('none');
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
  quietFeedback(output, 'searching');
  try {
    const page = await client.search(repo, {
      ...catalogFilter(),
      ...(after ? { after } : {}),
    });
    if (generation !== listGeneration) return;
    state.repository(true);
    if (!after) rows.replaceChildren();
    for (const item of page.items)
      rows.append(
        artifactRow(item, {
          open: () => {
            run(() => openArtifact(repo, item.id, item.name));
          },
          download: () => {
            run(() => downloads.enqueue(repo, item.id, item.name));
          },
        }),
      );
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
    quietFeedback(output, 'loaded', { count: rows.rows.length });
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
const deepLinks = installDeepLinks({
  output,
  repository,
  run,
  connected: () => state.credential() !== 'none',
  isOpen: (repo, id) => selected?.repository === repo && selected.id === id,
  open: async (repo, id) => {
    const artifact = await client.artifact(repo, id);
    await openArtifact(repo, id, artifact.descriptor.name);
  },
  reconnect: (repo) => {
    repository.value = repo;
    repository.dispatchEvent(new Event('input', { bubbles: true }));
    element('connect', HTMLFormElement).requestSubmit();
  },
});
const auth = installAuthConsole({
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
  // Signed in: update notifications and the feedback form follow the same role.
  updates: { connect: connectSigned },
  backups,
  management,
  userTokens,
  session: (credential) => {
    state.session(credential);
  },
  routes: deepLinks,
  getGeneration: () => authenticationGeneration,
  nextGeneration: () => ++authenticationGeneration,
  isRepositoryEdited: () => repositoryEdited,
  setRepositoryEdited: (val) => {
    repositoryEdited = val;
  },
  getStopSignal: () => upload.signal(),
});
expireSession = (error) => {
  if (state.credential() !== 'session') return false;
  auth.expire(error);
  return true;
};
element('search', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(() => list());
};
installCatalogFilter(() => {
  run(() => list());
});
const annotationFields = {
  '/value/labels': 'labels',
  '/value/metadata': 'metadata',
  '/value/collections': 'collections',
};
element('edit', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(
    withFieldErrors(annotationFields, async () => {
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
    }),
  );
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
deepLinks.start();

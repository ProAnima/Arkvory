import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback, errorKey, UiError } from './feedback.js';
import { installStorageForm } from './storage-form.js';
import { appendEvents, showPreview, showUsage } from './storage-view.js';

interface Access {
  read: boolean;
  manage: boolean;
  remove: boolean;
  events: boolean;
}
const noAccess: Access = { read: false, manage: false, remove: false, events: false };

function storageElements() {
  return {
    panel: element('storage-panel', HTMLDetailsElement),
    form: element('storage-form', HTMLFormElement),
    fields: element('storage-fields', HTMLFieldSetElement),
    output: element('storage-status', HTMLOutputElement),
    preview: element('storage-preview-list', HTMLUListElement),
    events: element('storage-events', HTMLUListElement),
    eventsSection: element('storage-events-section', HTMLDetailsElement),
    usage: element('storage-usage', HTMLParagraphElement),
    capacity: element('storage-capacity', HTMLParagraphElement),
    refresh: element('storage-refresh', HTMLButtonElement),
    inspect: element('storage-preview', HTMLButtonElement),
    save: element('storage-save', HTMLButtonElement),
    more: element('storage-events-more', HTMLButtonElement),
    acknowledge: element('storage-ack', HTMLInputElement),
  };
}

interface StorageContext {
  client: ArkvoryClient;
  ui: ReturnType<typeof storageElements>;
  form: ReturnType<typeof installStorageForm>;
  state: {
    repository: string;
    generation: number;
    revision: number | undefined;
    loaded: boolean;
    busy: boolean;
    access: Access;
    next: string | undefined;
    controller: AbortController;
  };
}
type Operation = (repo: string, signal: AbortSignal, current: () => boolean) => Promise<void>;

async function permittedActions(client: ArkvoryClient, repo: string, signal: AbortSignal) {
  const permissions = await client.permissions(signal);
  const actions = new Set(
    permissions.bindings.filter((b) => b.resource.id === repo).flatMap((b) => b.actions),
  );
  return {
    read: actions.has('storage.read'),
    manage: actions.has('storage.manage'),
    remove: actions.has('artifact.delete'),
    events: actions.has('diagnostics.read'),
  };
}

async function loadStorage(ctx: StorageContext, ...[repo, signal, current]: Parameters<Operation>) {
  const { client, ui, form, state } = ctx;
  const [policy, totals, logs] = await Promise.all([
    state.access.read ? client.storagePolicy(repo, signal) : undefined,
    state.access.read ? client.storageUsage(repo, signal) : undefined,
    state.access.events ? client.storageEvents(repo, {}, signal) : undefined,
  ]);
  if (!current()) return;
  state.loaded = true;
  ui.preview.replaceChildren();
  ui.acknowledge.checked = false;
  ui.form.hidden = !policy;
  if (policy) {
    state.revision = policy.revision;
    form.fill(policy.policy);
    message(ui.output, 'storageRevision', { revision: policy.revision, count: policy.lastDeleted });
    if (policy.lastError)
      feedback(ui.output, 'storageRunFailed', { code: policy.lastError }, 'error');
  }
  if (totals) showUsage(ui.usage, ui.capacity, totals);
  ui.events.replaceChildren();
  state.next = logs?.next ?? undefined;
  if (logs) appendEvents(ui.events, logs.items);
  ui.eventsSection.hidden = !state.access.events;
}

async function saveStorage(ctx: StorageContext, ...[repo, signal, current]: Parameters<Operation>) {
  const { client, ui, form, state } = ctx;
  if (state.revision === undefined || !state.access.manage) return;
  if (form.enabled() && (!state.access.remove || !ui.acknowledge.checked))
    throw new UiError('storageConfirmRequired');
  await client.setStoragePolicy(repo, state.revision, form.read(), signal);
  if (!current()) return;
  await loadStorage(ctx, repo, signal, current);
  if (current()) feedback(ui.output, 'storageSaved', {}, 'success');
}

function controls({ ui, state }: StorageContext) {
  ui.fields.disabled = state.busy || !state.access.manage || state.revision === undefined;
  ui.save.disabled = ui.fields.disabled;
  ui.save.hidden = !state.access.manage;
  ui.inspect.disabled = state.busy || !state.access.remove || state.revision === undefined;
  ui.inspect.hidden = !state.access.remove;
  ui.refresh.disabled = state.busy;
  ui.more.disabled = state.busy || !state.next;
}

function clearStorage(ctx: StorageContext) {
  const { ui, state } = ctx;
  state.generation++;
  state.controller.abort();
  Object.assign(state, {
    controller: new AbortController(),
    repository: '',
    revision: undefined,
    loaded: false,
    busy: false,
    next: undefined,
    access: noAccess,
  });
  ui.panel.hidden = true;
  ui.panel.open = false;
  ui.form.hidden = true;
  ui.form.reset();
  ctx.form.reset();
  ui.preview.replaceChildren();
  ui.events.replaceChildren();
  for (const node of [ui.usage, ui.output, ui.capacity]) clearMessage(node);
  ui.eventsSection.hidden = true;
  controls(ctx);
}

/** One storage request at a time; a newer repository context discards late results. */
async function operate(ctx: StorageContext, action: Operation) {
  const { ui, state } = ctx;
  if (state.busy || !state.repository) return;
  const version = state.generation,
    repo = state.repository;
  state.busy = true;
  controls(ctx);
  try {
    await action(repo, state.controller.signal, () => version === state.generation);
  } catch (error) {
    if (version === state.generation) feedback(ui.output, errorKey(error), {}, 'error');
  } finally {
    if (version === state.generation) {
      state.busy = false;
      controls(ctx);
    }
  }
}

export function installStoragePolicy(client: ArkvoryClient) {
  const ctx: StorageContext = {
    client,
    ui: storageElements(),
    form: installStorageForm(),
    state: {
      repository: '',
      generation: 0,
      revision: undefined,
      loaded: false,
      busy: false,
      access: noAccess,
      next: undefined,
      controller: new AbortController(),
    },
  };
  const { ui, state } = ctx;
  const load: Operation = (...args) => loadStorage(ctx, ...args);
  ui.refresh.onclick = () => {
    void operate(ctx, load);
  };
  ui.panel.addEventListener('toggle', () => {
    if (ui.panel.open && !state.loaded) void operate(ctx, load);
  });
  ui.form.addEventListener('input', () => {
    ui.preview.replaceChildren();
  });
  ui.form.onsubmit = (event) => {
    event.preventDefault();
    void operate(ctx, (...args) => saveStorage(ctx, ...args));
  };
  ui.inspect.onclick = () => {
    void operate(ctx, async (repo, signal, current) => {
      const result = await client.previewStoragePolicy(repo, signal);
      if (!current()) return;
      showPreview(ui.preview, result.items);
      message(ui.output, result.hasMore ? 'storagePreviewMore' : 'storagePreviewCount', {
        count: result.items.length,
      });
    });
  };
  ui.more.onclick = () => {
    void operate(ctx, async (repo, signal, current) => {
      if (!state.next) return;
      const page = await client.storageEvents(repo, { after: state.next }, signal);
      if (!current()) return;
      appendEvents(ui.events, page.items);
      state.next = page.next ?? undefined;
    });
  };
  return {
    clear: () => {
      clearStorage(ctx);
    },
    async connect(repo: string) {
      if (state.repository === repo) return;
      clearStorage(ctx);
      state.repository = repo;
      const version = state.generation;
      try {
        const access = await permittedActions(client, repo, state.controller.signal);
        if (version !== state.generation) return;
        state.access = access;
        ui.panel.hidden = !access.read && !access.events;
        controls(ctx);
      } catch {
        if (version === state.generation) ui.panel.hidden = true;
      }
    },
  };
}

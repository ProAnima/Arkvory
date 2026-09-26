import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { readStoragePolicy } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, dateMessage } from './i18n.js';
import { feedback, errorKey, UiError } from './feedback.js';

// arkvory-exception ARCH-028 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installStoragePolicy(client: ArkvoryClient) {
  const panel = element('storage-panel', HTMLDetailsElement),
    form = element('storage-form', HTMLFormElement),
    fields = element('storage-fields', HTMLFieldSetElement),
    output = element('storage-status', HTMLOutputElement),
    preview = element('storage-preview-list', HTMLUListElement),
    events = element('storage-events', HTMLUListElement),
    usage = element('storage-usage', HTMLParagraphElement),
    refresh = element('storage-refresh', HTMLButtonElement),
    inspect = element('storage-preview', HTMLButtonElement),
    save = element('storage-save', HTMLButtonElement),
    acknowledge = element('storage-ack', HTMLInputElement);
  const input = (id: string) => element('storage-' + id, HTMLInputElement);
  const grouping = element('storage-grouping', HTMLSelectElement),
    channels = element('storage-channels', HTMLTextAreaElement);
  function channelVisibility() {
    const label = channels.closest('label');
    if (label) label.hidden = grouping.value !== 'package-channel';
  }
  grouping.addEventListener('change', channelVisibility);
  let repository = '',
    generation = 0,
    revision: number | undefined,
    loaded = false,
    busy = false;
  let mayManage = false,
    mayDelete = false,
    mayRead = false,
    mayEvents = false,
    next: string | undefined;
  let controller = new AbortController();
  const more = element('storage-events-more', HTMLButtonElement);
  function controls() {
    fields.disabled = busy || !mayManage || revision === undefined;
    save.disabled = fields.disabled;
    save.hidden = !mayManage;
    inspect.disabled = busy || !mayDelete || revision === undefined;
    inspect.hidden = !mayDelete;
    refresh.disabled = busy;
    more.disabled = busy || !next;
  }
  function clear() {
    generation++;
    controller.abort();
    controller = new AbortController();
    repository = '';
    revision = undefined;
    loaded = false;
    busy = false;
    next = undefined;
    mayManage = false;
    mayDelete = false;
    mayRead = false;
    mayEvents = false;
    panel.hidden = true;
    panel.open = false;
    form.hidden = true;
    form.reset();
    preview.replaceChildren();
    events.replaceChildren();
    for (const node of [usage, output, element('storage-capacity', HTMLParagraphElement)]) {
      node.textContent = '';
      for (const attribute of Array.from(node.attributes))
        if (attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
    }
    element('storage-events-section', HTMLDetailsElement).hidden = true;
    controls();
  }
  async function operate(
    action: (repo: string, signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) {
    if (busy || !repository) return;
    const version = generation,
      repo = repository;
    busy = true;
    controls();
    try {
      await action(repo, controller.signal, () => version === generation);
    } catch (error) {
      if (version === generation) feedback(output, errorKey(error), {}, 'error');
    } finally {
      if (version === generation) {
        busy = false;
        controls();
      }
    }
  }
  function showEvents(items: Awaited<ReturnType<ArkvoryClient['storageEvents']>>['items']) {
    for (const e of items) {
      const li = document.createElement('li'),
        time = document.createElement('span'),
        code = document.createElement('span');
      dateMessage(time, e.occurredAt);
      code.textContent = ` · ${e.level} · ${e.code}`;
      const details = document.createElement('pre');
      details.className = 'mono';
      details.textContent = JSON.stringify(e.details, null, 2);
      li.append(time, code, details);
      events.append(li);
    }
  }
  async function load(repo: string, signal: AbortSignal, current: () => boolean) {
    const [state, totals, logs] = await Promise.all([
      mayRead ? client.storagePolicy(repo, signal) : undefined,
      mayRead ? client.storageUsage(repo, signal) : undefined,
      mayEvents ? client.storageEvents(repo, {}, signal) : undefined,
    ]);
    if (!current()) return;
    loaded = true;
    preview.replaceChildren();
    acknowledge.checked = false;
    form.hidden = !state;
    if (state) {
      revision = state.revision;
      const p = state.policy;
      input('enabled').checked = p.enabled;
      grouping.value = p.grouping;
      channelVisibility();
      for (const [id, value] of Object.entries({
        keep: p.keepLast,
        age: p.minAgeHours,
        interval: p.intervalMinutes,
        quota: p.quotaBytes ?? '',
        warning: p.warningPercent,
        critical: p.criticalPercent,
        protected: p.protectedLabels.join(', '),
      }))
        input(id).value = String(value);
      channels.value = p.channels.map((c) => `${c.label}=${String(c.keepLast)}`).join('\n');
      message(output, 'storageRevision', { revision: state.revision, count: state.lastDeleted });
      if (state.lastError) feedback(output, 'storageRunFailed', { code: state.lastError }, 'error');
    }
    if (totals) {
      message(usage, 'storageUsage', {
        published: totals.publishedBytes,
        pending: totals.pendingBytes,
        retired: totals.retiredBytes,
        total: totals.reservedBytes,
        quota: totals.quotaBytes ?? '∞',
      });
      const stateNode = element('storage-capacity', HTMLParagraphElement);
      message(
        stateNode,
        totals.state === 'critical' || totals.state === 'exceeded'
          ? 'storageCritical'
          : totals.state === 'warning'
            ? 'storageWarning'
            : 'storageNormal',
      );
    }
    events.replaceChildren();
    next = logs?.next ?? undefined;
    if (logs) showEvents(logs.items);
    element('storage-events-section', HTMLDetailsElement).hidden = !mayEvents;
  }
  refresh.onclick = () => {
    void operate(load);
  };
  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) void operate(load);
  });
  form.addEventListener('input', () => {
    preview.replaceChildren();
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    void operate(async (repo, signal, current) => {
      if (revision === undefined || !mayManage) return;
      if (input('enabled').checked && (!mayDelete || !acknowledge.checked))
        throw new UiError('storageConfirmRequired');
      let policy;
      try {
        policy = readStoragePolicy({
          enabled: input('enabled').checked,
          grouping: grouping.value,
          keepLast: Number(input('keep').value),
          minAgeHours: Number(input('age').value),
          intervalMinutes: Number(input('interval').value),
          quotaBytes: input('quota').value.trim() || null,
          warningPercent: Number(input('warning').value),
          criticalPercent: Number(input('critical').value),
          protectedLabels: input('protected')
            .value.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          channels: channels.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const [label, count, ...extra] = s.split('=');
              if (extra.length || !count?.trim()) throw new Error('Invalid channel');
              return { label, keepLast: Number(count) };
            }),
        });
      } catch {
        throw new UiError('errorInput');
      }
      await client.setStoragePolicy(repo, revision, policy, signal);
      if (current()) {
        await load(repo, signal, current);
        if (current()) feedback(output, 'storageSaved', {}, 'success');
      }
    });
  };
  inspect.onclick = () => {
    void operate(async (repo, signal, current) => {
      const result = await client.previewStoragePolicy(repo, signal);
      if (!current()) return;
      preview.replaceChildren();
      for (const item of result.items) {
        const li = document.createElement('li');
        li.textContent = `${item.name} · ${item.id} · ${item.size} B`;
        preview.append(li);
      }
      message(output, result.hasMore ? 'storagePreviewMore' : 'storagePreviewCount', {
        count: result.items.length,
      });
    });
  };
  more.onclick = () => {
    void operate(async (repo, signal, current) => {
      if (!next) return;
      const page = await client.storageEvents(repo, { after: next }, signal);
      if (!current()) return;
      showEvents(page.items);
      next = page.next ?? undefined;
      // Bound DOM memory even when browsing the full diagnostic history.
      while (events.childElementCount > 300) events.firstElementChild?.remove();
    });
  };
  return {
    clear,
    async connect(repo: string) {
      if (repository === repo) return;
      clear();
      repository = repo;
      const version = generation;
      try {
        const permissions = await client.permissions(controller.signal);
        if (version !== generation) return;
        const actions = new Set(
          permissions.bindings.filter((b) => b.resource.id === repo).flatMap((b) => b.actions),
        );
        mayRead = actions.has('storage.read');
        mayManage = actions.has('storage.manage');
        mayDelete = actions.has('artifact.delete');
        mayEvents = actions.has('diagnostics.read');
        panel.hidden = !mayRead && !mayEvents;
        controls();
      } catch {
        if (version === generation) panel.hidden = true;
      }
    },
  };
}

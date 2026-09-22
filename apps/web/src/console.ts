import { DepotClient } from '@proanima/depot-sdk';
import { record, text, stringMap } from '@proanima/depot-contracts';
import { element } from './dom.js';
import { installAssetHistory } from './asset-history.js';
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
let stop: AbortController | undefined;
let selected: { repository: string; id: string; revision: number; name: string } | undefined;
let selectionGeneration = 0;
const run = (action: () => Promise<void>) => {
  void action().catch((error: unknown) => {
    output.textContent = error instanceof Error ? error.message : 'Operation failed';
  });
};
async function openArtifact(repo: string, id: string, name: string) {
  const generation = ++selectionGeneration;
  const a = await client.annotations(repo, id);
  if (generation !== selectionGeneration || repo !== repository.value) return;
  selected = { repository: repo, id, revision: a.revision, name };
  element('selected', HTMLInputElement).value = id;
  element('labels', HTMLInputElement).value = a.labels.join(', ');
  element('collections', HTMLInputElement).value = a.collections.join(', ');
  element('metadata', HTMLTextAreaElement).value = JSON.stringify(a.metadata, null, 2);
  output.textContent = `Revision ${String(a.revision)}`;
}
function clearSelection() {
  selectionGeneration++;
  selected = undefined;
  for (const id of ['selected', 'labels', 'collections']) element(id, HTMLInputElement).value = '';
  element('metadata', HTMLTextAreaElement).value = '{}';
}
for (const input of [repository, token]) input.addEventListener('input', clearSelection);
const resetHistory = installAssetHistory(client, repository, token, openArtifact, run);
function hashFile(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/console/hash-worker.js', { type: 'module' });
    const done = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      done();
      reject(new Error('Остановлено / Cancelled'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onerror = () => {
      done();
      reject(new Error('Hash worker failed'));
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const value = record(event.data);
        if (typeof value['sha256'] === 'string') {
          done();
          resolve(value['sha256']);
        } else if (typeof value['bytes'] === 'number') {
          progress.value = value['bytes'];
          output.textContent = 'SHA-256…';
        } else if (value['error']) {
          done();
          reject(new Error('Hashing failed'));
        }
      } catch (error) {
        done();
        reject(error instanceof Error ? error : new Error('Hashing failed'));
      }
    };
    worker.postMessage(file);
  });
}
async function list(after?: string) {
  const page = await client.search(repository.value, {
    q: element('query', HTMLInputElement).value,
    label: element('filter-label', HTMLInputElement).value,
    ...(after ? { after } : {}),
  });
  if (!after) rows.replaceChildren();
  for (const item of page.items) {
    const row = document.createElement('tr'),
      name = document.createElement('td'),
      id = document.createElement('td'),
      actions = document.createElement('td');
    name.textContent = item.name;
    id.textContent = item.id;
    const button = document.createElement('button');
    button.textContent = 'Открыть / Open';
    button.onclick = () => {
      run(() => openArtifact(repository.value, item.id, item.name));
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
  output.textContent = `${String(rows.rows.length)} файлов / files`;
}
element('connect', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(() => list());
};
element('search', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(() => list());
};
element('logout', HTMLButtonElement).onclick = () => {
  stop?.abort();
  token.value = '';
  rows.replaceChildren();
  clearSelection();
  resetHistory();
  output.textContent = 'Отключено / Disconnected';
};
element('cancel', HTMLButtonElement).onclick = () => stop?.abort();
element('upload', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (stop) throw new Error('Upload already running');
    const file = element('file', HTMLInputElement).files?.[0];
    if (!file) throw new Error('Выберите файл / Choose a file');
    if (file.size > 5 * 1024 ** 3) throw new Error('Maximum file size is 5 GiB');
    stop = new AbortController();
    progress.max = Math.max(1, file.size);
    progress.value = 0;
    try {
      if (!uploadId.value) {
        const sha256 = await hashFile(file, stop.signal);
        const key = element('idempotency', HTMLInputElement);
        if (!key.value) key.value = crypto.randomUUID();
        const upload = await client.create(
          repository.value,
          key.value,
          { name: file.name, size: String(file.size), sha256, labels: [], metadata: {} },
          stop.signal,
        );
        uploadId.value = upload.id;
      }
      const result = await client.resume(repository.value, uploadId.value, file, {
        signal: stop.signal,
        onProgress: (bytes) => {
          progress.value = bytes;
          output.textContent = `Загрузка / Upload: ${String(Math.round((bytes / file.size) * 100))}%`;
        },
      });
      output.textContent = `Готово / Published: ${result.id}`;
      await list();
    } finally {
      stop = undefined;
    }
  });
};
element('new-upload', HTMLButtonElement).onclick = () => {
  if (!stop) {
    uploadId.value = '';
    element('idempotency', HTMLInputElement).value = '';
  }
};
element('edit', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (!selected) throw new Error('Выберите файл / Select a file');
    const artifact = selected;
    const split = (id: string) =>
      element(id, HTMLInputElement)
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const raw: unknown = JSON.parse(element('metadata', HTMLTextAreaElement).value);
    const next = await client.annotate(artifact.repository, artifact.id, artifact.revision, {
      labels: split('labels'),
      collections: split('collections'),
      metadata: stringMap(raw),
    });
    if (selected !== artifact) return;
    artifact.revision = next.revision;
    output.textContent = `Сохранено / Saved, revision ${String(next.revision)}`;
  });
};
element('register-package', HTMLButtonElement).onclick = () => {
  run(async () => {
    if (!selected) throw new Error('Select a file');
    const value = await client.registerPackage(selected.repository, selected.id);
    output.textContent = `UPack: ${text(value['name'])} ${text(value['version'])}`;
  });
};
element('download', HTMLButtonElement).onclick = () => {
  run(async () => {
    if (!selected) throw new Error('Выберите файл / Select a file');
    if (!window.showSaveFilePicker)
      throw new Error(
        'Потоковое сохранение требует Chrome/Edge и HTTPS. Используйте SDK в других браузерах. / Streaming save requires Chrome/Edge and HTTPS.',
      );
    const artifact = { ...selected };
    const repo = artifact.repository;
    const handle = await window.showSaveFilePicker({ suggestedName: artifact.name });
    const response = await client.download(repo, artifact.id);
    if (!response.body) throw new Error('Missing download stream');
    let target: WritableStream<Uint8Array>;
    try {
      target = await handle.createWritable();
    } catch (error) {
      await response.body.cancel();
      throw error;
    }
    await response.body.pipeTo(target);
    output.textContent = 'Скачано / Downloaded';
  });
};
element('asset', HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (!selected) throw new Error('Select a file');
    await client.setAsset(
      selected.repository,
      element('asset-path', HTMLInputElement).value,
      selected.id,
      Number(element('asset-revision', HTMLInputElement).value),
    );
    output.textContent = 'Asset сохранён / saved';
  });
};

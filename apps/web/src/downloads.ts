import { ArkvoryClient, DownloadQueue, checkpointedDownload } from '@proanima/arkvory-sdk';
import { BrowserDownloadStorage, openDownloadWorkspace } from './download-storage.js';
import { DownloadJournal } from './download-journal.js';
import type { DownloadReceipt } from './download-journal.js';
import { DownloadView } from './download-view.js';
import type { DownloadFile } from './download-view.js';
import { chooseDestination } from './download-picker.js';
import { element } from './dom.js';
import { feedback, UiError, showFailure } from './feedback.js';
import { showView } from './shell.js';

class Downloads {
  private readonly queue = new DownloadQueue();
  private readonly status = element('download-status', HTMLOutputElement);
  private readonly files = new Map<string, DownloadFile>();
  private readonly view: DownloadView;
  private workspace: Promise<FileSystemDirectoryHandle> | undefined;
  private generation = 0;
  private adding = false;
  private resetting = Promise.resolve();
  constructor(
    private readonly baseUrl: string,
    private readonly token: HTMLInputElement,
  ) {
    this.view = new DownloadView(
      this.queue,
      this.files,
      (id) => {
        // Invoke picker directly in the click gesture, before scheduling promises.
        void this.resume(id).catch((error: unknown) => {
          this.report(error);
        });
      },
      (id) => {
        this.run(() => this.queue.cancel(id));
      },
    );
    element('downloads-pause', HTMLButtonElement).onclick = () => {
      this.queue.pauseAll();
    };
    element('downloads-resume', HTMLButtonElement).onclick = () => {
      this.queue.resumeAll(
        new Set([...this.files].filter(([, file]) => file.storage.destination).map(([id]) => id)),
      );
    };
    element('downloads-clear-waiting', HTMLButtonElement).onclick = () => {
      this.run(() => this.queue.clearWaiting());
    };
    element('downloads-cancel', HTMLButtonElement).onclick = () => {
      this.run(() => this.queue.cancelAll());
    };
    element('downloads-clear-finished', HTMLButtonElement).onclick = () => {
      this.run(() => this.queue.clearFinished());
    };
    element('downloads-restore', HTMLButtonElement).onclick = () => {
      this.run(() => this.restore());
    };
    element('download-policy', HTMLFormElement).onsubmit = (event) => {
      event.preventDefault();
      this.run(() => {
        this.queue.configure({
          concurrency: Number(element('download-concurrency', HTMLInputElement).value),
          startIntervalMs: Number(element('download-interval', HTMLInputElement).value),
          queueTimeoutMs: Number(element('download-wait', HTMLInputElement).value) * 1000,
        });
        feedback(this.status, 'downloadPolicySaved', {}, 'success');
      });
    };
    token.addEventListener('input', () => {
      this.reset();
    });
    window.addEventListener('beforeunload', (event) => {
      if (this.queue.snapshot.some((item) => !['completed', 'cancelled'].includes(item.state)))
        event.preventDefault();
    });
  }
  private report(error: unknown) {
    showFailure(this.status, error);
  }
  private run(work: () => unknown) {
    void Promise.resolve()
      .then(work)
      .catch((error: unknown) => {
        this.report(error);
      });
  }
  private directory() {
    this.workspace ??= openDownloadWorkspace().catch((error: unknown) => {
      this.workspace = undefined;
      throw error;
    });
    return this.workspace;
  }
  reset() {
    this.generation++;
    this.queue.pauseAll();
    this.resetting = this.resetting.then(async () => {
      await this.queue.cancelAll();
      await this.queue.clearFinished();
      this.queue.resumeAll();
    });
    this.run(() => this.resetting);
  }
  private async identity(secret: string) {
    const client = new ArkvoryClient(this.baseUrl, () => secret);
    const permissions = await client.permissions(AbortSignal.timeout(30_000));
    return {
      client,
      owner: JSON.stringify([permissions.profile, permissions.id, permissions.credentialId]),
    };
  }
  private async unique(destination: FileSystemFileHandle, id?: string) {
    for (const [other, file] of this.files)
      if (
        other !== id &&
        file.storage.destination &&
        (await destination.isSameEntry(file.storage.destination))
      )
        throw new UiError('downloadDuplicate');
  }
  private async resume(id: string) {
    const file = this.files.get(id),
      current = this.generation;
    if (
      !file ||
      this.adding ||
      !this.queue.snapshot.some((item) => item.id === id && item.resumable)
    )
      return;
    this.adding = true;
    try {
      if (!file.storage.destination) {
        const destination = await chooseDestination(file.name);
        if (!destination) return;
        await this.unique(destination, id);
        if (current !== this.generation) return;
        file.storage.destination = destination;
      }
      this.queue.resume(id);
      this.view.render();
    } finally {
      this.adding = false;
    }
  }
  private add(
    receipt: DownloadReceipt,
    client: ArkvoryClient,
    directory: FileSystemDirectoryHandle,
    destination: FileSystemFileHandle | undefined,
    bytes?: number,
  ) {
    const journal = new DownloadJournal(directory);
    const storage = new BrowserDownloadStorage(directory, receipt.id, destination);
    const transfer = checkpointedDownload(
      client,
      receipt.id,
      receipt.repository,
      receipt.artifactId,
      storage,
    );
    const job = {
      ...transfer,
      discard: async () => {
        // Remove intent first: a reload during cancellation must never resurrect the job.
        await journal.remove(receipt.id);
        await transfer.discard();
      },
    };
    this.files.set(receipt.id, { name: receipt.name, storage });
    try {
      if (bytes !== undefined) this.queue.restore(job, bytes);
      else this.queue.enqueue(job);
    } catch (error) {
      this.files.delete(receipt.id);
      throw error;
    }
  }
  private async restore() {
    if (this.adding) return;
    this.adding = true;
    const current = this.generation,
      secret = this.token.value;
    try {
      await this.resetting;
      const { client, owner } = await this.identity(secret);
      const directory = await this.directory();
      const receipts = await new DownloadJournal(directory).read(this.baseUrl, owner);
      for (const receipt of receipts) {
        if (current !== this.generation) return;
        if (this.files.has(receipt.id)) continue;
        const prefix = await new BrowserDownloadStorage(directory, receipt.id, undefined).prefix();
        if (current !== this.generation) return;
        this.add(receipt, client, directory, undefined, prefix.size);
      }
      if (current === this.generation)
        feedback(this.status, receipts.length ? 'downloadRestoreReady' : 'downloadRestoreEmpty');
    } finally {
      this.adding = false;
    }
  }
  async enqueue(repository: string, artifactId: string, name: string) {
    if (this.adding) return;
    const current = this.generation,
      secret = this.token.value;
    this.adding = true;
    try {
      const destination = await chooseDestination(name);
      if (!destination) return;
      await this.resetting;
      await this.unique(destination);
      const { client, owner } = await this.identity(secret);
      const directory = await this.directory();
      if (current !== this.generation) return;
      const journal = new DownloadJournal(directory);
      if ((await journal.read(this.baseUrl, owner)).length >= 64)
        throw new UiError('downloadQueueFull');
      if (current !== this.generation) return;
      const receipt = {
        id: crypto.randomUUID(),
        repository,
        artifactId,
        name,
        server: this.baseUrl,
        owner,
        createdAt: Date.now(),
      };
      await journal.save(receipt);
      if (current !== this.generation) {
        await journal.remove(receipt.id);
        return;
      }
      try {
        this.add(receipt, client, directory, destination);
      } catch (error) {
        await journal.remove(receipt.id);
        throw error;
      }
      showView('downloads');
      feedback(this.status, 'downloadAdded', {}, 'success');
    } finally {
      this.adding = false;
    }
  }
}

export function installDownloads(baseUrl: string, token: HTMLInputElement) {
  return new Downloads(baseUrl, token);
}

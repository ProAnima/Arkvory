import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { feedback, UiError, showFailure } from './feedback.js';
import { hashFile } from './file-hash.js';
import { exceedsServerLimit } from './server-limits.js';
import { installUploadControls } from './upload-controls.js';
import type { consoleRunner } from './console-runner.js';

interface UploadFormDeps {
  readonly client: ArkvoryClient;
  readonly repository: HTMLInputElement;
  readonly output: HTMLOutputElement;
  readonly run: ReturnType<typeof consoleRunner>;
  /** Refreshes the catalog after a publication. */
  readonly list: () => Promise<void>;
  /** Another upload of the page (a build attachment) also holds the interaction lock. */
  readonly busyElsewhere: () => boolean;
}

/**
 * The upload form of the catalog: hashing, creating and resuming an upload with progress, pause
 * and a fresh start. It owns the transfer in flight; the console asks it whether one runs.
 */
export function installUploadForm(deps: UploadFormDeps) {
  let stop: AbortController | undefined;
  const uploadId = element('upload-id', HTMLInputElement),
    progress = element('progress', HTMLProgressElement),
    transferStatus = element('transfer-status', HTMLOutputElement);
  const uploadBusy = installUploadControls(() => stop !== undefined || deps.busyElsewhere());
  element('cancel', HTMLButtonElement).onclick = () => stop?.abort();
  element('upload', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    deps.run(async () => {
      if (stop) throw new UiError('uploadRunning');
      const file = element('file', HTMLInputElement).files?.[0];
      if (!file) throw new UiError('chooseFileError');
      if (await exceedsServerLimit(deps.client, file.size)) throw new UiError('fileTooLarge');
      const repo = deps.repository.value;
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
          const upload = await deps.client.create(
            repo,
            key.value,
            { name: file.name, size: String(file.size), sha256, labels: [], metadata: {} },
            stop.signal,
          );
          uploadId.value = upload.id;
        }
        const result = await deps.client.resume(repo, uploadId.value, file, {
          signal: stop.signal,
          onProgress: (bytes) => {
            progress.value = bytes;
            feedback(transferStatus, 'uploading', {
              percent: Math.round((bytes / file.size) * 100),
            });
          },
        });
        progress.value = progress.max;
        feedback(transferStatus, 'published', { id: result.id }, 'success');
        try {
          await deps.list();
          feedback(deps.output, 'published', { id: result.id }, 'success');
        } catch {
          feedback(deps.output, 'publishedRefresh');
        }
      } catch (error) {
        if (stop.signal.aborted) {
          feedback(transferStatus, 'paused');
          return;
        }
        showFailure(transferStatus, error);
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
  return { running: () => stop !== undefined, signal: () => stop };
}

import { record } from '@proanima/depot-contracts';
import { UiError } from './feedback.js';

export function hashFile(
  file: File,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
): Promise<string> {
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
        } else if (typeof value['bytes'] === 'number') onProgress(value['bytes']);
        else if (value['error']) {
          done();
          reject(new UiError('hashError'));
        }
      } catch {
        done();
        reject(new UiError('hashError'));
      }
    };
    worker.postMessage(file);
  });
}

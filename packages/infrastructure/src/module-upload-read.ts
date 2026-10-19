import type { UploadByteRange, ScopedUploads } from '@proanima/arkvory-application';
import { partsBackendOf } from '@proanima/arkvory-application';
import type { UploadRead } from '@proanima/arkvory-extension-api';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { AccessScopes } from './module-catalog.js';
import { serviceCall, toModule } from './module-errors.js';

export function moduleUploads(uploads: ScopedUploads, scopes: AccessScopes): UploadRead {
  return {
    upload: (scope, repository, id) =>
      serviceCall(async () => {
        const upload = await uploads.upload(scopes.principalsOf(scope), repository, id);
        if (!upload || scopes.signal(scope).aborted) return null;
        return {
          repository,
          id,
          state: 'pending',
          backendId: partsBackendOf(upload),
          size: upload.descriptor.size,
          sha256: upload.descriptor.sha256,
        };
      }),
    read(scope, ref, range, signal) {
      const lifetime = scopes.signal(scope);
      const check = () => {
        if (lifetime.aborted || signal.aborted)
          throw new ModuleServiceError('unavailable', 'Upload read cancelled');
      };
      // The application owns its pin until the iterator closes. Abort closes even an iterator
      // suspended at yield, without relying on the module to request another chunk.
      const source = uploads.read(
        scopes.principalsOf(scope),
        ref.repository,
        ref.id,
        snapshotRange(range),
        { throwIfAborted: check },
      );
      const iterator = source[Symbol.asyncIterator]();
      let closed = false;
      const detach = () => {
        lifetime.removeEventListener('abort', abort);
        signal.removeEventListener('abort', abort);
      };
      const finish = async () => {
        closed = true;
        detach();
        return (await iterator.return?.()) ?? { done: true as const, value: undefined };
      };
      const abort = () => {
        void finish().catch(() => undefined);
      };
      lifetime.addEventListener('abort', abort, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      if (lifetime.aborted || signal.aborted) abort();
      const stream: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          try {
            check();
            if (closed) return { done: true as const, value: undefined };
            const item = await iterator.next();
            check();
            if (item.done) {
              closed = true;
              detach();
            }
            return item;
          } catch (error) {
            await finish();
            throw toModule(error);
          }
        },
        return: finish,
      };
      return stream;
    },
  };
}

function snapshotRange(value: unknown): UploadByteRange {
  const start: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'start') : undefined;
  const end: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'end') : undefined;
  return {
    start: typeof start === 'number' ? start : NaN,
    end: typeof end === 'number' ? end : NaN,
  };
}

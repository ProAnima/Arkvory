import type { DepotClient } from './client.js';
import type { DownloadJob } from './download-queue.js';
import { DepotIntegrityError, releaseReader } from './transfer.js';

/** Per-job private staging. A checkpoint becomes readable only after writer.close(). */
export interface DownloadStorage {
  prefix(): Promise<Blob>;
  /** Append exactly at offset; preserve the previously sealed prefix on abort. */
  append(offset: number): Promise<WritableStream<Uint8Array>>;
  /** Atomically publish sealed, verified staging; never expose partial bytes as the final file. */
  commit(): Promise<void>;
  /** Idempotent staging removal. Must not delete the committed destination. */
  discard(): Promise<void>;
}

export function checkpointedDownload(
  client: Pick<DepotClient, 'downloadVerified'>,
  id: string,
  repository: string,
  artifactId: string,
  storage: DownloadStorage,
): DownloadJob {
  return {
    id,
    discard: () => storage.discard(),
    async run(context) {
      context.signal.throwIfAborted();
      const prefix = await storage.prefix();
      context.progress(prefix.size);
      // Rehash the sealed prefix before opening a writer that could invalidate its snapshot.
      const stream = await client
        .downloadVerified(repository, artifactId, {
          prefix,
          signal: context.signal,
          onRetry: (event) => {
            context.retry(event);
          },
        })
        .catch(async (error: unknown) => {
          if (error instanceof DepotIntegrityError) await storage.discard();
          throw error;
        });
      const reader = stream.getReader();
      let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
      let bytes = prefix.size;
      let writing = false;
      try {
        context.signal.throwIfAborted();
        writer = (await storage.append(prefix.size)).getWriter();
        for (;;) {
          context.signal.throwIfAborted();
          const part = await reader.read();
          context.signal.throwIfAborted();
          if (part.done) break;
          writing = true;
          await writer.write(part.value);
          writing = false;
          bytes += part.value.byteLength;
          context.progress(bytes);
        }
        await writer.close();
        writer.releaseLock();
        writer = undefined;
        context.beginCommit();
        await storage.commit();
      } catch (error) {
        if (writer) {
          try {
            // Only completed writes may be checkpointed. A failed disk write is rolled back.
            if (writing || error instanceof DepotIntegrityError) await writer.abort(error);
            else await writer.close();
          } finally {
            writer.releaseLock();
          }
        }
        if (error instanceof DepotIntegrityError) await storage.discard();
        throw error;
      } finally {
        await releaseReader(reader);
      }
    },
  };
}

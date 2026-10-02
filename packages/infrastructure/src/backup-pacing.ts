import { setTimeout as delay } from 'node:timers/promises';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { ContentSource } from '@proanima/arkvory-application';

const creditMs = 1000;

/**
 * Copy bandwidth cap of one capture (ARKVORY_BACKUP_BYTES_PER_SECOND, ADR 0056). Chunks pass
 * through unchanged; after each one the stream waits until its bytes fit the rate. At most one
 * second of idle time (reading, hashing) is credited, so the average stays at the rate and a
 * pause never turns into a larger burst. This is a local limit of the backup process, not a
 * budget shared with API transfers.
 */
export class PacedContentSource implements ContentSource {
  private nextAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly source: ContentSource,
    private readonly bytesPerSecond: number,
    private readonly monotonic: () => number = () => performance.now(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      delay(milliseconds).then(() => undefined),
  ) {
    if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond < 1)
      throw new BackupFailure('invalid_argument', 'Invalid backup bandwidth');
  }

  async *read(entry: InventoryEntry): AsyncIterable<Uint8Array> {
    for await (const chunk of this.source.read(entry)) {
      yield chunk;
      const now = this.monotonic();
      this.nextAt =
        Math.max(this.nextAt, now - creditMs) + (chunk.byteLength * 1000) / this.bytesPerSecond;
      if (this.nextAt > now) await this.sleep(this.nextAt - now);
    }
  }
}

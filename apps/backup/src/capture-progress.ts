import type { CaptureEvent } from '@proanima/arkvory-application';
import { recordCaptureProgress } from '@proanima/arkvory-infrastructure';
import type { BackupPool, DiagnosticLogger } from '@proanima/arkvory-infrastructure';

const intervalMs = 1000;

/**
 * Turns capture events into job progress rows and one log line per phase. Counters arrive per
 * content chunk; at most one write per second is in flight and the newest counters win, so a
 * slow database never slows the copy. Progress is informational: a failed write is dropped.
 */
export function captureObserver(
  pool: BackupPool,
  logger: Pick<DiagnosticLogger, 'write'>,
  started?: (jobId: string) => void,
) {
  let latest: CaptureEvent | undefined;
  let writing: Promise<void> | undefined;
  let writtenAt = Number.NEGATIVE_INFINITY;
  let logged = '';
  const write = (event: CaptureEvent) => {
    const counters = event.counters;
    if (!counters) return;
    writtenAt = performance.now();
    writing = recordCaptureProgress(pool, event, counters)
      .catch(() => undefined)
      .finally(() => {
        writing = undefined;
        if (latest !== event) pump();
      });
  };
  const pump = () => {
    const event = latest;
    if (!event?.counters || writing) return;
    const final = event.counters.blobsDone === event.counters.blobsTotal;
    if (final || performance.now() - writtenAt >= intervalMs) write(event);
  };
  return {
    record(event: CaptureEvent): void {
      started?.(event.jobId);
      const phase = `${event.jobId}:${String(event.attempt)}:${event.phase}`;
      if (phase !== logged) {
        logged = phase;
        logger.write({
          level: 'info',
          component: 'backup',
          code: 'backup.phase',
          jobId: event.jobId,
          pointId: event.pointId,
          phase: event.phase,
          attempt: event.attempt,
        });
      }
      latest = event;
      pump();
    },
    /** Waits for the write in flight; completion of the job sets the final counters anyway. */
    async flush(): Promise<void> {
      await writing;
    },
  };
}

import { randomUUID } from 'node:crypto';
import { BackupFailure } from '@proanima/arkvory-domain';
import { CaptureBackup } from '@proanima/arkvory-application';
import type { BackupCommand } from './arguments.js';
import type { CliContext } from './context.js';
import { sourceConfig } from './config.js';
import { captureDependencies, openCaptureSource, openVault } from './source.js';

export async function runCapture(
  command: Extract<BackupCommand, { kind: 'capture' }>,
  context: CliContext,
): Promise<number> {
  const config = sourceConfig(context.env);
  const vault = await openVault(command.vault, config.dataDirectory);
  const { vaultId } = await vault.identity();
  const started = performance.now();
  const source = await openCaptureSource(config);
  try {
    context.logger.write({
      level: 'info',
      component: 'backup',
      code: 'backup.capture.started',
      vaultId,
    });
    const capture = new CaptureBackup(
      captureDependencies(source, vault, {
        config,
        release: context.release,
        progress: (event) => {
          context.logger.write({
            level: 'info',
            component: 'backup',
            code: 'backup.phase',
            jobId: event.jobId,
            pointId: event.pointId,
            phase: event.phase,
            attempt: event.attempt,
          });
        },
      }),
    );
    // Without a key every invocation is a new job; a key makes a retry reuse the same job.
    const result = await capture.run(command.idempotencyKey ?? `manual-${randomUUID()}`, {
      throwIfAborted() {
        context.cancellation.throwIfAborted();
        if (!source.active())
          throw new BackupFailure('lease_lost', 'Capture session to the database was lost');
      },
    });
    context.logger.write({
      level: 'info',
      component: 'backup',
      code: 'backup.capture.completed',
      jobId: result.jobId,
      pointId: result.pointId,
      vaultId,
      outcome: result.outcome,
      ...(result.snapshotAt === null ? {} : { snapshotAt: result.snapshotAt }),
      blobs: result.blobs,
      copied: result.copied,
      reused: result.reused,
      tables: result.tables,
      rows: result.rows,
      contentBytes: result.contentBytes,
      durationMs: Math.round(performance.now() - started),
    });
    return 0;
  } finally {
    await source.close();
  }
}

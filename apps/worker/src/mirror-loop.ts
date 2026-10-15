import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { MirrorSync, StageImport, mirrorErrorCode } from '@proanima/arkvory-application';
import {
  PostgresContentPins,
  PostgresMirrorState,
  failureCause,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticLogger,
  LocalBlobStore,
  MirrorSettings,
  PostgresCatalog,
} from '@proanima/arkvory-infrastructure';
import { SdkMirrorSource } from './mirror-source.js';
import { ServiceMirrorTarget, clearMirrorStaging } from './mirror-target.js';

export interface MirrorLoopOptions {
  readonly catalog: PostgresCatalog;
  readonly blobs: LocalBlobStore;
  readonly dataDirectory: string;
  readonly mirrors: readonly MirrorSettings[];
  readonly stop: AbortSignal;
  readonly diagnostics: DiagnosticLogger;
  /** Pause after a step that found the mirror caught up with the source. */
  readonly pollMs?: number;
}

/** 2 s doubling to 5 minutes: a lost source is retried without hammering it. */
export function mirrorBackoffMs(failures: number): number {
  return Math.min(300_000, 2000 * 2 ** Math.min(failures - 1, 8));
}

async function pause(ms: number, stop: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal: stop }).catch(() => undefined);
}

/**
 * Runs the synchronization of one mirrored repository until shutdown or lost storage ownership.
 * The key file is read before the first step and again after every failure, so a rotated key
 * is picked up without a restart; its content never reaches a log line.
 */
async function follow(
  mirror: MirrorSettings,
  options: MirrorLoopOptions,
  pins: PostgresContentPins,
): Promise<void> {
  const { stop, diagnostics, catalog } = options;
  const fields = { component: 'mirror', repository: mirror.repository } as const;
  let token = '';
  const source = new SdkMirrorSource(mirror.upstream, mirror.sourceRepository, () => token, stop);
  const dependencies = {
    repository: mirror.repository,
    // The stages are part of an import's identity: other stages start a new seed.
    source: [mirror.upstream, mirror.sourceRepository, ...(mirror.stages ?? [])].join('|'),
    upstream: source,
    target: new ServiceMirrorTarget(
      mirror.repository,
      catalog,
      options.blobs,
      options.dataDirectory,
      pins,
    ),
    states: new PostgresMirrorState(catalog.pool),
    now: () => new Date().toISOString(),
  };
  // With stages the repository imports promoted versions (ADR 0058); without, it mirrors.
  const sync = mirror.stages
    ? new StageImport({ ...dependencies, stages: mirror.stages })
    : new MirrorSync(dependencies);
  const cancellation = {
    throwIfAborted: () => {
      stop.throwIfAborted();
    },
  };
  // A function, not the property: the flag changes outside this loop.
  const stopped = () => stop.aborted;
  diagnostics.write({ level: 'info', ...fields, code: 'mirror.started' });
  let failures = 0;
  while (!stop.aborted && catalog.active) {
    try {
      if (failures > 0 || token === '') token = (await readFile(mirror.tokenFile, 'utf8')).trim();
      const step = await sync.step(cancellation);
      if (failures > 0)
        diagnostics.write({
          level: 'info',
          ...fields,
          code: 'mirror.recovered',
          attempts: failures,
        });
      failures = 0;
      if (step === 'idle') await pause(options.pollMs ?? 10_000, stop);
    } catch (error) {
      if (stopped()) break;
      failures++;
      diagnostics.write({
        level: 'warning',
        ...fields,
        code: 'mirror.step_failed',
        errorCode: mirrorErrorCode(error),
        attempts: failures,
      });
      await pause(mirrorBackoffMs(failures), stop);
    }
  }
  diagnostics.write({ level: 'info', ...fields, code: 'mirror.stopped' });
}

export interface MirrorStartup {
  readonly markDetached: (configured: readonly string[]) => Promise<void>;
  readonly clearStaging: () => Promise<void>;
}

/**
 * Before any loop: a mirror detached since the last start is never followed from its cursor,
 * and part files a crash left behind are no copy's any more (each copy writes its own anew).
 * Never throws, because it runs beside the jobs of this worker: the mark is retried with the
 * mirrors' backoff until it is written (no loop starts without it), the stop or lost ownership
 * (false); left-over part files only take space, so failing to clear them is reported.
 */
export async function prepareMirrors(
  startup: MirrorStartup,
  options: Pick<MirrorLoopOptions, 'mirrors' | 'stop' | 'diagnostics'>,
  active: () => boolean,
  backoffMs: (failures: number) => number = mirrorBackoffMs,
): Promise<boolean> {
  const { stop, diagnostics } = options;
  const configured = options.mirrors.map((mirror) => mirror.repository);
  for (let failures = 1; !stop.aborted && active(); failures++) {
    try {
      await startup.markDetached(configured);
    } catch (error) {
      diagnostics.write({
        level: 'warning',
        component: 'mirror',
        code: 'mirror.step_failed',
        errorCode: 'mirror_startup_failed',
        attempts: failures,
        ...failureCause(error),
      });
      await pause(backoffMs(failures), stop);
      continue;
    }
    try {
      await startup.clearStaging();
    } catch (error) {
      diagnostics.write({
        level: 'warning',
        component: 'mirror',
        code: 'mirror.step_failed',
        errorCode: 'mirror_staging_failed',
        attempts: 1,
        ...failureCause(error),
      });
    }
    return true;
  }
  return false;
}

/**
 * Every configured mirror follows its source independently; one failing source stops none.
 * The content pins (package manifests are read from pinned blobs) hold a database session of
 * their own and are closed when all loops have ended, before the caller closes the catalog.
 */
export async function runMirrors(options: MirrorLoopOptions): Promise<void> {
  const states = new PostgresMirrorState(options.catalog.pool);
  const startup = {
    markDetached: (configured: readonly string[]) => states.markDetached(configured),
    clearStaging: () => clearMirrorStaging(options.dataDirectory),
  };
  if (!(await prepareMirrors(startup, options, () => options.catalog.active))) return;
  if (options.mirrors.length === 0) return;
  const pins = new PostgresContentPins(options.catalog.pool);
  try {
    await Promise.all(options.mirrors.map((mirror) => follow(mirror, options, pins)));
  } finally {
    await pins.close();
  }
}

import { ModuleDataLedger } from './module-data-ledger.js';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { FileSink } from '@proanima/arkvory-extension-api';
import type { ModuleDataCoordinator, ModuleDataGuard } from './module-data-coordinator.js';
import { entryAt, measureTree, requireInside } from './module-data-paths.js';
import { hasCode } from './fs-durability.js';
import { requireVolumeRoom, statVolume } from './volume-space.js';
import type { VolumeProbe, VolumeReserve } from './volume-space.js';

export interface ModuleDataOptions {
  readonly dataDirectory: string;
  readonly moduleId: string;
  readonly quota: { readonly bytes: number; readonly files: number };
  readonly reserve: VolumeReserve;
  readonly readOnly: boolean;
  /** Hosted modules may read while accounting recovers; mutations still wait for admission. */
  readonly deferredAccounting?: boolean;
  readonly probe?: VolumeProbe;
  readonly requireRemoval?: () => void;
  /** Required for every writable directory; the host closes it after all directories. */
  readonly coordinator?: ModuleDataCoordinator;
  /** Called under the same module lock as generation admission; physical cache bytes
   * live outside this ledger and are represented by their persisted reservations. */
  readonly reservedUsage?: () => Promise<{ readonly bytes: number; readonly files: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only startup lock contention is retryable: never replay work that already entered. */
async function prepareAdmission<T>(
  coordinator: ModuleDataCoordinator,
  moduleId: string,
  work: (guard: ModuleDataGuard) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const admission = { entered: false };
    try {
      return await coordinator.run(moduleId, (guard) => {
        admission.entered = true;
        return work(guard);
      });
    } catch (error) {
      if (!signal || admission.entered || !hasCode(error, 'busy') || attempt >= 299) throw error;
      await delay(Math.min(100 * (attempt + 1), 1000), undefined, { signal });
    }
  }
}

/** Disk files are the reservations: after a crash no in-memory credit can be reused. */
export class ModuleDataAccounting {
  readonly root: string;
  readonly temporary: string;
  readonly sinks = new Set<FileSink>();
  bytes = 0;
  files = 0;
  readonly ledger: ModuleDataLedger;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly preparation = new AbortController();
  private accounted = false;
  private preparationFailed = false;

  constructor(readonly options: ModuleDataOptions) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(options.moduleId))
      throw new ModuleServiceError('invalid_input');
    for (const value of [options.quota.bytes, options.quota.files])
      if (!Number.isSafeInteger(value) || value < 0) throw new ModuleServiceError('invalid_input');
    if (!options.readOnly && !options.coordinator)
      throw new ModuleServiceError('unavailable', 'Data coordinator required');
    if (options.coordinator && !UUID.test(options.coordinator.owner))
      throw new ModuleServiceError('invalid_input');
    this.root = resolve(options.dataDirectory, 'module-data', options.moduleId);
    this.ledger = new ModuleDataLedger(this.root, options.coordinator?.owner ?? '');
    this.temporary = join(
      this.root,
      'tmp',
      'coordinated-v1',
      options.coordinator?.owner ?? 'reader',
    );
  }

  async initialize(): Promise<void> {
    await requireInside(this.options.dataDirectory, ['module-data', this.options.moduleId]);
    if (this.options.deferredAccounting) {
      // Read-only hosts need no write credit. Their explicit reconciliation supplies usage.
      if (!this.options.readOnly)
        void this.prepare().catch(() => {
          this.preparationFailed = true;
        });
      return;
    }
    await this.prepare();
  }

  requireAccounting(): void {
    if (this.preparationFailed) throw new ModuleServiceError('unavailable', 'Accounting failed');
    if (!this.accounted) throw new ModuleServiceError('busy', 'Accounting is recovering');
  }

  private async prepare(): Promise<void> {
    if (this.options.readOnly) return this.refresh();
    await this.run(
      async (guard) => {
        for (const area of ['data', 'cache', 'tmp/coordinated-v1']) {
          guard.check();
          await requireInside(this.root, area.split('/'));
          await mkdir(join(this.root, area), { recursive: true, mode: 0o700 });
        }
        guard.check();
        await mkdir(this.temporary, { recursive: true, mode: 0o700 });
      },
      false,
      this.preparation.signal,
    );
  }

  /** Only this protocol's dead owners are collectible. Unknown/legacy tmp stays charged.
   * No timestamp/PID heuristic: a paused or remote writer keeps its PostgreSQL owner lock.
   * Deployment must quiesce older writers that do not participate in this protocol.
   */
  private async cleanup(guard: ModuleDataGuard): Promise<boolean> {
    let recovered = false;
    const base = resolve(this.root, 'tmp', 'coordinated-v1');
    await requireInside(this.root, ['tmp', 'coordinated-v1']);
    const entries = await readdir(base, { withFileTypes: true }).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return [];
      throw error;
    });
    for (const entry of entries) {
      if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink())
        throw new ModuleServiceError('invalid_input', 'Invalid temporary owner');
    }
    // Persisted owners also detect session loss when a crash lost an empty tmp directory.
    for (const owner of new Set([...entries.map((entry) => entry.name), ...this.ledger.owners])) {
      const target = resolve(base, owner);
      if (dirname(target) !== base) throw new ModuleServiceError('invalid_input');
      await guard.orphan(owner, async () => {
        guard.check();
        await rm(target, { recursive: true, force: true });
        this.ledger.owners = this.ledger.owners.filter((known) => known !== owner);
        recovered = true;
      });
    }
    return recovered;
  }

  async refresh(): Promise<void> {
    const data = await measureTree(join(this.root, 'data'));
    const cache = await measureTree(join(this.root, 'cache'));
    this.bytes = data.bytes + cache.bytes;
    this.files = data.files + cache.files;
    this.accounted = true;
  }

  /** Credit only the target of THIS operation, at its current size. Other sinks are charged
   * in full. This deliberately refuses some concurrent replacements instead of double-crediting
   * an old file, and caps physical staging at one additional replaced file beyond the quota.
   */
  async quota(target: string, bytes: number, files: number): Promise<void> {
    const current = this.ledger.counts;
    const reserved = await this.options.reservedUsage?.();
    const before = await entryAt(target);
    const chargeBytes =
      current.bytes +
      current.temporaryBytes +
      (reserved?.bytes ?? 0) +
      bytes -
      (before?.isFile() ? before.size : 0);
    const chargeFiles =
      current.files +
      current.temporaryFiles +
      (reserved?.files ?? 0) +
      files -
      (before?.isFile() ? 1 : 0);
    if (
      !Number.isSafeInteger(chargeBytes) ||
      !Number.isSafeInteger(chargeFiles) ||
      chargeBytes > this.options.quota.bytes ||
      chargeFiles > this.options.quota.files
    )
      throw new ModuleServiceError('module_quota_exceeded');
  }

  async room(bytes: number): Promise<void> {
    await requireVolumeRoom(
      this.root,
      bytes,
      this.options.reserve,
      this.options.probe ?? statVolume,
    ).catch((error: unknown) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, 'code') === 'capacity_exceeded'
      )
        throw new ModuleServiceError('capacity_exceeded');
      throw error;
    });
  }

  run<T>(
    work: (guard: ModuleDataGuard) => Promise<T>,
    closing = false,
    signal?: AbortSignal,
  ): Promise<T> {
    const coordinator = this.options.coordinator;
    if (!coordinator || (this.closed && !closing))
      return Promise.reject(new ModuleServiceError('unavailable'));
    if (this.pending >= 64) return Promise.reject(new ModuleServiceError('busy'));
    this.pending++;
    const result = this.tail.then(() =>
      prepareAdmission(
        coordinator,
        this.options.moduleId,
        async (guard) => {
          if (this.preparationFailed)
            throw new ModuleServiceError('unavailable', 'Accounting failed');
          await this.ledger.begin(guard, signal);
          if (await this.cleanup(guard)) await this.ledger.rebuild(signal);
          guard.check();
          try {
            return await work(guard);
          } finally {
            guard.check();
            await this.ledger.commit(guard);
            this.bytes = this.ledger.counts.bytes;
            this.files = this.ledger.counts.files;
            this.accounted = true;
          }
        },
        signal,
      ),
    );
    this.tail = result
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return result;
  }

  reconcile(): Promise<void> {
    if (this.options.readOnly) return this.refresh();
    return this.run(() => this.ledger.rebuild(this.preparation.signal));
  }

  close(): Promise<void> {
    this.closed = true;
    this.preparation.abort();
    return (this.closing ??= (async () => {
      await this.tail;
      const errors: unknown[] = [];
      // Drain serially: shutdown itself must not overflow the bounded admission queue.
      for (const sink of this.sinks) {
        try {
          await sink.abort();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Module data close failed');
    })());
  }
}

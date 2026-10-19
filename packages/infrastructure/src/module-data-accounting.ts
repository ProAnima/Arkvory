import { ModuleDataLedger } from './module-data-ledger.js';
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
  readonly probe?: VolumeProbe;
  readonly requireRemoval?: () => void;
  /** Required for every writable directory; the host closes it after all directories. */
  readonly coordinator?: ModuleDataCoordinator;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    if (this.options.readOnly) return this.refresh();
    await this.run(async (guard) => {
      for (const area of ['data', 'cache', 'tmp/coordinated-v1']) {
        guard.check();
        await requireInside(this.root, area.split('/'));
        await mkdir(join(this.root, area), { recursive: true, mode: 0o700 });
      }
      guard.check();
      await mkdir(this.temporary, { recursive: true, mode: 0o700 });
    });
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
  }

  /** Credit only the target of THIS operation, at its current size. Other sinks are charged
   * in full. This deliberately refuses some concurrent replacements instead of double-crediting
   * an old file, and caps physical staging at one additional replaced file beyond the quota.
   */
  async quota(target: string, bytes: number, files: number): Promise<void> {
    const current = this.ledger.counts;
    const before = await entryAt(target);
    const chargeBytes =
      current.bytes + current.temporaryBytes + bytes - (before?.isFile() ? before.size : 0);
    const chargeFiles = current.files + current.temporaryFiles + files - (before?.isFile() ? 1 : 0);
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

  run<T>(work: (guard: ModuleDataGuard) => Promise<T>, closing = false): Promise<T> {
    const coordinator = this.options.coordinator;
    if (!coordinator || (this.closed && !closing))
      return Promise.reject(new ModuleServiceError('unavailable'));
    if (this.pending >= 64) return Promise.reject(new ModuleServiceError('busy'));
    this.pending++;
    const result = this.tail.then(() =>
      coordinator.run(this.options.moduleId, async (guard) => {
        await this.ledger.begin(guard);
        if (await this.cleanup(guard)) await this.ledger.rebuild();
        guard.check();
        try {
          return await work(guard);
        } finally {
          guard.check();
          await this.ledger.commit(guard);
          this.bytes = this.ledger.counts.bytes;
          this.files = this.ledger.counts.files;
        }
      }),
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
    return this.run(() => this.ledger.rebuild());
  }

  close(): Promise<void> {
    this.closed = true;
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

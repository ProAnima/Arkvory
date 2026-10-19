import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  CacheBuild,
  CacheRead,
  DerivedCache,
  ModuleSignal,
} from '@proanima/arkvory-extension-api';
import { PostgresModuleDataCoordinator } from './module-data-coordinator.js';
import { ModuleDataAccounting } from './module-data-accounting.js';
import { requireInside } from './module-data-paths.js';
import { requireVolumeRoom } from './volume-space.js';
import type { VolumeReserve } from './volume-space.js';
import { syncDirectory, hasCode } from './fs-durability.js';
import { DerivedCacheCatalog, derivedCacheUsage } from './derived-cache-catalog.js';
import {
  CacheQueue,
  cacheLock,
  requireBudget,
  requireKey,
  unavailable,
} from './derived-cache-runtime.js';
import type { CacheBudget } from './derived-cache-runtime.js';
import { DerivedCacheSession } from './derived-cache-session.js';
import { GenerationBuild } from './derived-cache-build.js';
import { GenerationRead, readCacheManifest } from './derived-cache-read.js';
import { removeCacheGeneration } from './derived-cache-cleanup.js';
import { StorageOwnership } from './storage-ownership.js';

export interface ModuleDerivedCacheOptions {
  readonly pool: Pool;
  readonly dataDirectory: string;
  readonly moduleId: string;
  readonly quota: CacheBudget;
  readonly reserve: VolumeReserve;
  readonly readOnly: boolean;
  /** Host-wide coordinator avoids an extra long-lived session per cache module. */
  readonly coordinator?: PostgresModuleDataCoordinator;
}

/** Shared derived groups. The module receives only build/read handles; it cannot mutate
 * their physical namespace through ModuleFiles. Neither locks nor timeouts prove OS death. */
export class ModuleDerivedCache implements DerivedCache {
  readonly ownerId = randomUUID();
  private readonly root: string;
  private readonly session: DerivedCacheSession;
  private readonly catalog: DerivedCacheCatalog;
  private readonly coordinator: PostgresModuleDataCoordinator;
  private readonly accounting: ModuleDataAccounting;
  private readonly queue = new CacheQueue();
  private readonly builds = new Set<GenerationBuild>();
  private readonly readers = new Set<GenerationRead>();
  private readonly manifests = new Map<string, Set<FileHandle>>();
  private opening: Promise<void> | undefined;
  private pendingReaders = 0;
  private stopped = false;
  private closing: Promise<void> | undefined;

  constructor(private readonly options: ModuleDerivedCacheOptions) {
    this.root = resolve(options.dataDirectory, 'module-derived-cache', options.moduleId);
    this.session = new DerivedCacheSession(options.pool, this.ownerId);
    this.catalog = new DerivedCacheCatalog(options.pool, options.moduleId);
    this.coordinator = options.coordinator ?? new PostgresModuleDataCoordinator(options.pool);
    this.accounting = new ModuleDataAccounting({
      ...options,
      coordinator: this.coordinator,
      reservedUsage: () => derivedCacheUsage(options.pool, options.moduleId),
    });
  }

  private check(): void {
    if (this.stopped) throw unavailable();
    this.session.check();
  }

  private async initialize(): Promise<void> {
    await this.session.get();
    this.check();
    if (this.options.readOnly) return;
    await this.accounting.initialize();
    await requireInside(this.options.dataDirectory, [
      'module-derived-cache',
      this.options.moduleId,
    ]);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await syncDirectory(join(this.options.dataDirectory, 'module-derived-cache'));
    this.check();
  }

  private async ready(): Promise<void> {
    if (this.stopped) throw unavailable();
    await (this.opening ??= this.initialize().catch((error: unknown) => {
      this.opening = undefined;
      throw error;
    }));
    this.check();
  }

  begin(key: string, budget: CacheBudget, signal: ModuleSignal): Promise<CacheBuild | null> {
    requireKey(key);
    // Read caller-owned properties once, before enqueueing or awaiting anything.
    // Validate the snapshot, never reread mutable properties/getters during admission/I/O.
    const input: unknown = budget;
    if (typeof input !== 'object' || input === null)
      throw new ModuleServiceError('invalid_input', 'Invalid cache reservation');
    const bytes: unknown = Reflect.get(input, 'bytes');
    const files: unknown = Reflect.get(input, 'files');
    const copied = { bytes, files };
    requireBudget(copied);
    const reservation = Object.freeze(copied);
    signal.throwIfAborted();
    if (this.options.readOnly) return Promise.reject(new ModuleServiceError('read_only'));
    return this.queue
      .run(async () => {
        await this.ready();
        signal.throwIfAborted();
        // Eviction cannot satisfy a reservation larger than the entire module quota.
        if (
          reservation.bytes > this.options.quota.bytes ||
          reservation.files > this.options.quota.files
        )
          return null;
        if (this.builds.size >= 8) return null;
        const client = await this.session.get();
        const id = randomUUID();
        const admit = () =>
          this.accounting.run(async (guard) => {
            guard.check();
            this.check();
            const counts = this.accounting.ledger.counts;
            return this.catalog.begin(
              client,
              this.ownerId,
              key,
              id,
              reservation,
              this.options.quota,
              {
                bytes: counts.bytes + counts.temporaryBytes,
                files: counts.files + counts.temporaryFiles,
              },
            );
          });
        await this.sweep(false);
        let admission = await admit();
        for (let attempt = 0; admission === 'budget' && attempt < 100; attempt++) {
          if (!(await this.sweep(true, 1))) break;
          admission = await admit();
        }
        if (admission !== 'admitted') return null;
        try {
          this.check();
          signal.throwIfAborted();
          await mkdir(join(this.root, id), { mode: 0o700 });
          await syncDirectory(this.root);
        } catch (error) {
          await this.catalog.retire(client, this.ownerId, id).catch(() => undefined);
          throw error;
        }
        const build = new GenerationBuild(join(this.root, id), reservation, signal, {
          check: () => {
            this.check();
          },
          room: (bytes) => requireVolumeRoom(this.root, bytes, this.options.reserve),
          publish: (actual, hash) =>
            this.queue.run(async () => {
              try {
                this.check();
              } catch (error) {
                if (await this.catalog.hasPublished(id)) return;
                throw error;
              }
              if (
                !(await this.catalog.publish(
                  await this.session.get(),
                  this.ownerId,
                  id,
                  actual,
                  hash,
                ))
              )
                throw unavailable();
            }),
          retire: () =>
            this.queue.run(async () => {
              this.check();
              await this.catalog.retire(await this.session.get(), this.ownerId, id);
              await this.sweep(false);
            }),
          settled: () => {
            this.builds.delete(build);
          },
        });
        this.builds.add(build);
        return build;
      })
      .catch((error: unknown) => {
        if (hasCode(error, 'busy')) return null;
        throw error;
      });
  }

  open(key: string, signal: ModuleSignal): Promise<CacheRead | null> {
    requireKey(key);
    signal.throwIfAborted();
    // Serialize registration with close and bound waiting acquisitions before taking a pool slot.
    if (this.pendingReaders + this.readers.size >= 64) return Promise.resolve(null);
    this.pendingReaders++;
    return this.queue
      .run(async () => {
        await this.ready();
        signal.throwIfAborted();
        const client = await this.options.pool.connect();
        const ownership = new StorageOwnership(client);
        const ref = randomUUID();
        try {
          await ownership.startConnection();
          const generation = await this.catalog.open(client, this.ownerId, key, ref);
          if (!generation) {
            await ownership.close();
            return null;
          }
          const directory = join(this.root, generation.id);
          await requireInside(this.options.dataDirectory, [
            'module-derived-cache',
            this.options.moduleId,
            generation.id,
          ]);
          const handles = new Set<FileHandle>();
          this.manifests.set(ref, handles);
          const entries = await readCacheManifest(directory, generation.manifestHash, handles);
          this.manifests.delete(ref);
          this.check();
          signal.throwIfAborted();
          const reader = new GenerationRead(directory, entries, signal, {
            check: () => {
              this.check();
              if (!ownership.active) throw unavailable();
            },
            release: async () => {
              // Native I/O is drained. The persisted ref excludes eviction while a pool
              // slot is borrowed for DELETE, even after this session pin is released.
              await ownership.close();
              await this.catalog.releaseRead(ref);
              this.readers.delete(reader);
            },
          });
          this.readers.add(reader);
          return reader;
        } catch (error) {
          await ownership.close();
          if (!this.manifests.get(ref)?.size) {
            this.manifests.delete(ref);
            await this.catalog.releaseRead(ref).catch(() => undefined);
          }
          if (
            hasCode(error, 'ENOENT') ||
            hasCode(error, 'unavailable') ||
            error instanceof SyntaxError
          )
            return null;
          throw error;
        }
      })
      .catch((error: unknown) => {
        if (hasCode(error, 'busy')) return null;
        throw error;
      })
      .finally(() => {
        this.pendingReaders--;
      });
  }

  private async sweep(evict: boolean, maximum = 100): Promise<number> {
    const client = await this.session.get();
    const candidates = await this.catalog.candidates(client, evict, 100);
    let removed = 0;
    for (const generation of candidates) {
      this.check();
      if (!(await this.catalog.startDelete(client, generation.id))) continue;
      try {
        if (
          await removeCacheGeneration(this.root, generation.id, () => {
            this.check();
          })
        ) {
          await this.catalog.removed(client, generation.id);
          removed++;
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [
          cacheLock('generation', generation.id),
        ]);
      }
      if (removed >= maximum) break;
    }
    return removed;
  }

  reconcile(): Promise<void> {
    if (this.options.readOnly) return Promise.resolve();
    return this.queue.run(async () => {
      await this.ready();
      await this.sweep(false);
    });
  }

  close(): Promise<void> {
    this.stopped = true;
    return (this.closing ??= this.closeOwned());
  }

  private async closeOwned(): Promise<void> {
    // Revoke every build before waiting; no queued write may publish during shutdown.
    const builds = [...this.builds].map((build) => build.quiesce());
    const readers = [...this.readers].map((reader) => reader.release());
    const drained = Promise.allSettled([...builds, ...readers]);
    await this.queue.drain();
    const manifests = [...this.manifests].map(async ([ref, handles]) => {
      for (const handle of handles) {
        await handle.close();
        handles.delete(handle);
      }
      await this.catalog.releaseRead(ref);
      this.manifests.delete(ref);
    });
    const results = [...(await drained), ...(await Promise.allSettled(manifests))];
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        failures.push(reason);
      }
    }
    // Drain accounting before attesting quiescence; every later close still runs on failure.
    for (const finish of [
      () => this.accounting.close(),
      async () => {
        if (!this.options.coordinator) await this.coordinator.close();
      },
      async () => {
        if (failures.length || !this.session.started) return;
        const client = await this.session.current();
        // A lost owner must release its slot before borrowing for the quiescence update.
        if (!client) await this.session.close();
        await this.catalog.quiesce(this.ownerId, client);
      },
      () => this.session.close(),
    ]) {
      try {
        await finish();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Cache close failed');
  }
}

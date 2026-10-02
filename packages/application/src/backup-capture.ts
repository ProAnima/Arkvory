import {
  ArkvoryError,
  BackupFailure,
  INVENTORY_FILE,
  POINT_FORMAT,
  POINT_FORMAT_VERSION,
  inventoryLine,
  manifestDocument,
  parseBackupManifest,
  parseInventoryEntry,
  parseVaultJson,
  tableFileName,
} from '@proanima/arkvory-domain';
import type {
  BackupManifest,
  BackupPhase,
  PointTable,
  VaultIdentity,
} from '@proanima/arkvory-domain';
import type { Cancellation, IdentitySource } from './ports.js';
import type {
  CaptureJobs,
  CaptureLease,
  CapturePins,
  CaptureVault,
  ContentSource,
  SnapshotSession,
  SnapshotSource,
  StagedPoint,
  UnlinkBarrier,
} from './backup-ports.js';

export interface CaptureLimits {
  /** Inventory page and pin batch. */
  readonly inventoryBatch: number;
  readonly maxInventoryEntries: number;
  /** Upper bound of all table exports, counted in UTF-16 units (at most the UTF-8 bytes). */
  readonly maxTableCharacters: number;
  /** From closing the unlink barrier until snapshot T is closed. */
  readonly snapshotMilliseconds: number;
}
export const defaultCaptureLimits: CaptureLimits = {
  inventoryBatch: 500,
  maxInventoryEntries: 10_000_000,
  maxTableCharacters: 32 * 1024 ** 3,
  snapshotMilliseconds: 30 * 60 * 1000,
};

export interface CaptureEvent {
  readonly phase: BackupPhase;
  readonly jobId: string;
  readonly pointId: string;
  readonly attempt: number;
}
export interface CaptureDependencies {
  readonly jobs: CaptureJobs;
  readonly barrier: UnlinkBarrier;
  readonly pins: CapturePins;
  readonly snapshots: SnapshotSource;
  readonly content: ContentSource;
  readonly vault: CaptureVault;
  readonly identity: IdentitySource;
  readonly release: { readonly version: string; readonly commit: string | null };
  readonly limits?: CaptureLimits;
  readonly progress?: (event: CaptureEvent) => void;
}
export interface CaptureResult {
  readonly outcome: 'created' | 'existing';
  readonly jobId: string;
  readonly pointId: string;
  readonly snapshotAt: string | null;
  readonly blobs: number;
  readonly contentBytes: string;
  readonly copied: number;
  readonly reused: number;
  readonly tables: number;
  readonly rows: number;
}
interface ExportedSnapshot {
  readonly session: Pick<
    SnapshotSession,
    | 'takenAt'
    | 'exportedId'
    | 'schemaVersion'
    | 'postgresMajor'
    | 'sourceInstanceId'
    | 'pendingUploads'
    | 'excludedTables'
  >;
  readonly inventory: BackupManifest['inventory'];
  readonly tables: readonly PointTable[];
}

/** Maps any error to the closed failure vocabulary that jobs and exit codes use. */
export function backupFailureOf(error: unknown): BackupFailure {
  if (error instanceof BackupFailure) return error;
  if (error instanceof ArkvoryError)
    switch (error.code) {
      case 'integrity_mismatch':
        return new BackupFailure('integrity_mismatch', error.message, { cause: error });
      case 'capacity_exceeded':
        return new BackupFailure('storage_full', error.message, { cause: error });
      case 'busy':
        return new BackupFailure('busy', error.message, { cause: error });
      case 'unavailable':
      case 'rate_limited':
        return new BackupFailure('unavailable', error.message, { cause: error });
      case 'invalid_input':
      case 'not_found':
      case 'conflict':
      case 'forbidden':
      case 'unauthorized':
      case 'read_only':
      case 'internal':
        return new BackupFailure('unexpected', error.message, { cause: error });
    }
  return new BackupFailure('unexpected', 'Backup operation failed', { cause: error });
}

function withCancellation(
  lease: CaptureLease,
  cancellation: Cancellation | undefined,
): CaptureLease {
  if (!cancellation) return lease;
  return {
    jobId: lease.jobId,
    pointId: lease.pointId,
    generation: lease.generation,
    attempt: lease.attempt,
    close: () => lease.close(),
    throwIfAborted() {
      cancellation.throwIfAborted();
      lease.throwIfAborted();
    },
  };
}

function fromManifest(outcome: CaptureResult['outcome'], manifest: BackupManifest): CaptureResult {
  return {
    outcome,
    jobId: manifest.jobId,
    pointId: manifest.pointId,
    snapshotAt: manifest.snapshot.takenAt,
    blobs: manifest.inventory.count,
    contentBytes: manifest.inventory.contentBytes,
    copied: 0,
    reused: manifest.inventory.count,
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
  };
}

/**
 * CaptureBackup (ADR 0054): durable job → unlink barrier → snapshot T → pins of the whole
 * published set → barrier reopened → table export → snapshot closed → content copy outside any
 * SQL transaction → manifest → atomic point commit → job completed and pins released.
 */
export class CaptureBackup {
  private readonly limits: CaptureLimits;
  constructor(private readonly deps: CaptureDependencies) {
    this.limits = deps.limits ?? defaultCaptureLimits;
    const { inventoryBatch, maxInventoryEntries, maxTableCharacters, snapshotMilliseconds } =
      this.limits;
    if (
      ![inventoryBatch, maxInventoryEntries, maxTableCharacters, snapshotMilliseconds].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      inventoryBatch > 5000
    )
      throw new BackupFailure('invalid_argument', 'Invalid capture limits');
  }

  /** cancellation (an operator signal) stops the attempt like a lost lease, recorded as failed. */
  async run(idempotencyKey: string, cancellation?: Cancellation): Promise<CaptureResult> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))
      throw new BackupFailure('invalid_argument', 'Invalid idempotency key');
    const vault = await this.deps.vault.identity();
    const start = await this.deps.jobs.start({
      idempotencyKey,
      vaultId: vault.vaultId,
      jobId: this.deps.identity.next(),
      pointId: this.deps.identity.next(),
    });
    if (start.kind === 'completed') {
      const manifest = await this.deps.vault.point(start.pointId);
      if (!manifest) throw new BackupFailure('point_not_found', 'Completed point is not in vault');
      return fromManifest('existing', manifest);
    }
    const lease = withCancellation(start.lease, cancellation);
    try {
      // An earlier attempt may have committed before it could record completion.
      const committed = await this.existingPoint(lease);
      if (committed) return await this.adopt(lease, committed);
      return await this.attempt(lease, vault);
    } finally {
      await lease.close();
    }
  }

  private async existingPoint(lease: CaptureLease): Promise<BackupManifest | null> {
    try {
      return await this.deps.vault.point(lease.pointId);
    } catch (error) {
      const failure = backupFailureOf(error);
      await this.deps.jobs.fail(lease, failure.code).catch(() => undefined);
      throw failure;
    }
  }

  private async adopt(lease: CaptureLease, manifest: BackupManifest): Promise<CaptureResult> {
    if (manifest.jobId !== lease.jobId)
      throw new BackupFailure('unexpected', 'Point belongs to a different job');
    await this.deps.jobs.committing(lease, manifest.snapshot.takenAt);
    await this.deps.jobs.complete(lease);
    this.report(lease, 'done');
    return fromManifest('existing', manifest);
  }

  private async attempt(lease: CaptureLease, vault: VaultIdentity): Promise<CaptureResult> {
    const stage = await this.deps.vault.stage(lease.pointId, lease.attempt);
    let committing = false;
    try {
      const startedAt = this.deps.identity.now();
      const exported = await this.exportSnapshot(lease, stage);
      const copy = await this.copyContent(lease, stage);
      await this.enter(lease, 'manifest');
      const manifest = parseBackupManifest(
        manifestDocument({
          format: POINT_FORMAT,
          version: POINT_FORMAT_VERSION,
          pointId: lease.pointId,
          jobId: lease.jobId,
          vaultId: vault.vaultId,
          sourceInstanceId: exported.session.sourceInstanceId,
          release: this.deps.release,
          schemaVersion: exported.session.schemaVersion,
          postgresMajor: exported.session.postgresMajor,
          snapshot: { takenAt: exported.session.takenAt, exportedId: exported.session.exportedId },
          startedAt,
          completedAt: this.deps.identity.now(),
          inventory: exported.inventory,
          tables: exported.tables,
          excludedTables: exported.session.excludedTables,
          pendingUploads: exported.session.pendingUploads,
        }),
      );
      committing = true;
      await this.deps.jobs.committing(lease, manifest.snapshot.takenAt);
      this.report(lease, 'commit');
      if ((await stage.commit(manifest)) === 'exists') {
        const existing = await this.deps.vault.point(lease.pointId);
        if (existing?.jobId !== lease.jobId)
          throw new BackupFailure('unexpected', 'Point id is already used by another job');
        await this.deps.jobs.complete(lease);
        this.report(lease, 'done');
        return fromManifest('existing', existing);
      }
      await this.deps.jobs.complete(lease);
      this.report(lease, 'done');
      return { ...fromManifest('created', manifest), ...copy };
    } catch (error) {
      const failure = backupFailureOf(error);
      // Recording the failure is best effort: when it cannot be stored, the lease expires and
      // the next start() fences the attempt, releasing its pins and barrier. After committing
      // the outcome is unknown and only reconciliation from the vault may decide it.
      if (!committing) await this.deps.jobs.fail(lease, failure.code).catch(() => undefined);
      throw failure;
    } finally {
      await stage.discard();
    }
  }

  private async exportSnapshot(lease: CaptureLease, stage: StagedPoint): Promise<ExportedSnapshot> {
    this.report(lease, 'barrier');
    const deadline = Date.parse(this.deps.identity.now()) + this.limits.snapshotMilliseconds;
    await this.deps.barrier.close(lease);
    const session = await this.deps.snapshots.open(lease);
    try {
      await this.enter(lease, 'pins');
      const totals = { count: 0, bytes: 0n };
      const inventory = await stage.write(
        INVENTORY_FILE,
        this.pinnedInventory(session, lease, totals, deadline),
        lease,
      );
      // Every listed entry has a committed pin, so unlink admission may resume for all else.
      await this.deps.barrier.reopen(lease);
      await this.enter(lease, 'tables');
      const tables: PointTable[] = [];
      const budget = { left: this.limits.maxTableCharacters };
      for (const table of session.tables) {
        const digest = await stage.write(
          tableFileName(table),
          this.boundedRows(session.rows(table), budget, deadline),
          lease,
        );
        tables.push({
          name: table,
          rows: digest.lines,
          sha256: digest.sha256,
          bytes: digest.bytes,
        });
      }
      // T ends here: content is copied later without holding the database snapshot.
      await session.close();
      return {
        session,
        inventory: {
          count: totals.count,
          contentBytes: totals.bytes.toString(),
          sha256: inventory.sha256,
          bytes: inventory.bytes,
        },
        tables,
      };
    } finally {
      await session.close();
    }
  }

  private async *pinnedInventory(
    session: SnapshotSession,
    lease: CaptureLease,
    totals: { count: number; bytes: bigint },
    deadline: number,
  ): AsyncIterable<string> {
    let after: string | undefined;
    for (;;) {
      this.checkDeadline(deadline);
      lease.throwIfAborted();
      const page = await session.inventory(after, this.limits.inventoryBatch);
      const last = page.at(-1);
      if (!last) return;
      if (totals.count + page.length > this.limits.maxInventoryEntries)
        throw new BackupFailure('capture_too_large', 'Inventory exceeds the configured limit');
      await this.deps.pins.pin(
        lease,
        page.map((entry) => entry.id),
      );
      for (const entry of page) {
        totals.count++;
        totals.bytes += BigInt(entry.size);
        yield inventoryLine(entry);
      }
      after = last.id;
    }
  }

  private async *boundedRows(
    rows: AsyncIterable<string>,
    budget: { left: number },
    deadline: number,
  ): AsyncIterable<string> {
    let seen = 0;
    for await (const row of rows) {
      budget.left -= row.length + 1;
      if (budget.left < 0)
        throw new BackupFailure('capture_too_large', 'Table export exceeds the configured limit');
      if (++seen % 1000 === 0) this.checkDeadline(deadline);
      yield row;
    }
    this.checkDeadline(deadline);
  }

  private async copyContent(lease: CaptureLease, stage: StagedPoint) {
    await this.enter(lease, 'blobs');
    const totals = { copied: 0, reused: 0 };
    for await (const line of stage.lines(INVENTORY_FILE, lease)) {
      lease.throwIfAborted();
      const entry = parseInventoryEntry(parseVaultJson(line));
      // Content ids are immutable, so content stored by an earlier point is shared as is.
      if (await this.deps.vault.hasBlob(entry)) {
        totals.reused++;
        continue;
      }
      await this.deps.vault.putBlob(entry, this.deps.content.read(entry), lease);
      totals.copied++;
    }
    return totals;
  }

  private checkDeadline(deadline: number): void {
    if (Date.parse(this.deps.identity.now()) > deadline)
      throw new BackupFailure('capture_timeout', 'Snapshot phase exceeded its time limit');
  }

  private async enter(lease: CaptureLease, phase: BackupPhase): Promise<void> {
    await this.deps.jobs.advance(lease, phase);
    this.report(lease, phase);
  }

  private report(lease: CaptureLease, phase: BackupPhase): void {
    this.deps.progress?.({
      phase,
      jobId: lease.jobId,
      pointId: lease.pointId,
      attempt: lease.attempt,
    });
  }
}

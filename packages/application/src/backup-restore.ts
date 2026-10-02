import {
  BackupFailure,
  INVENTORY_FILE,
  parseInventoryEntry,
  parseVaultJson,
  restoreSchemaGate,
  tableFileName,
} from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
import type { Cancellation, IdentitySource } from './ports.js';
import type {
  ReadableVault,
  RestoreDatabase,
  RestoreNormalization,
  RestoreStorage,
} from './backup-ports.js';
import { VerifyPoint } from './backup-verify.js';

export type RestorePhase = 'verify' | 'content' | 'schema' | 'tables' | 'migrate' | 'done';
export interface RestoreDependencies {
  readonly vault: ReadableVault;
  readonly database: RestoreDatabase;
  readonly storage: RestoreStorage;
  readonly identity: Pick<IdentitySource, 'now'>;
  /** Schema of this release; a newer backup is refused. */
  readonly releaseSchema: number;
  /** Oldest schema with a verified restore normalization. */
  readonly minimumSchema: number;
  readonly progress?: (phase: RestorePhase) => void;
}
export interface RestorePlan {
  readonly pointId: string;
  readonly schemaVersion: number;
  readonly snapshotAt: string;
  readonly blobs: number;
  readonly contentBytes: string;
  readonly tables: number;
  readonly rows: number;
}
export type RestoreReport =
  | (RestorePlan & { readonly outcome: 'planned' })
  | (RestorePlan & {
      readonly outcome: 'restored';
      readonly normalization: RestoreNormalization;
      readonly loadedRows: number;
    });

function plan(manifest: BackupManifest): RestorePlan {
  return {
    pointId: manifest.pointId,
    schemaVersion: manifest.schemaVersion,
    snapshotAt: manifest.snapshot.takenAt,
    blobs: manifest.inventory.count,
    contentBytes: manifest.inventory.contentBytes,
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
  };
}

/**
 * Restore into an empty database and an empty storage directory only. Content is copied and
 * verified before the database transaction, so a committed catalog never names missing bytes.
 * Without confirmation only the read-only preflight runs.
 */
export class RestoreToEmptyTarget {
  private readonly verifier: VerifyPoint;
  constructor(private readonly deps: RestoreDependencies) {
    this.verifier = new VerifyPoint(deps.vault);
  }

  async run(
    request: { readonly pointId: string; readonly confirmed: boolean },
    cancellation: Cancellation,
  ): Promise<RestoreReport> {
    this.deps.progress?.('verify');
    const manifest = await this.verifier.require(request.pointId);
    const gate = restoreSchemaGate(
      manifest.schemaVersion,
      this.deps.releaseSchema,
      this.deps.minimumSchema,
    );
    if (gate !== 'compatible')
      throw new BackupFailure(
        'schema_mismatch',
        gate === 'too_new'
          ? 'Backup schema is newer than this release'
          : 'Backup schema predates the supported restore normalization',
      );
    const check = await this.verifier.verify(manifest, false, cancellation);
    if (!check.ok) throw new BackupFailure('integrity_mismatch', 'Point failed verification');
    await this.deps.database.requireEmpty();
    await this.deps.storage.requireEmpty();
    if (!request.confirmed) return { outcome: 'planned', ...plan(manifest) };
    this.deps.progress?.('content');
    const storageId = await this.deps.storage.prepare();
    await this.copyContent(manifest, cancellation);
    this.deps.progress?.('schema');
    await this.deps.database.prepare(manifest.schemaVersion);
    this.deps.progress?.('tables');
    const loaded = await this.deps.database.load(
      {
        schemaVersion: manifest.schemaVersion,
        pointId: manifest.pointId,
        storageId,
        restoredAt: this.deps.identity.now(),
        tables: manifest.tables.map((table) => ({
          name: table.name,
          rows: table.rows,
          lines: () =>
            this.deps.vault.lines(manifest.pointId, tableFileName(table.name), table, cancellation),
        })),
      },
      cancellation,
    );
    this.deps.progress?.('migrate');
    await this.deps.database.finish();
    this.deps.progress?.('done');
    const { rows: loadedRows, ...normalization } = loaded;
    return { outcome: 'restored', ...plan(manifest), normalization, loadedRows };
  }

  private async copyContent(manifest: BackupManifest, cancellation: Cancellation): Promise<void> {
    for await (const line of this.deps.vault.lines(
      manifest.pointId,
      INVENTORY_FILE,
      manifest.inventory,
      cancellation,
    )) {
      cancellation.throwIfAborted();
      const entry = parseInventoryEntry(parseVaultJson(line));
      await this.deps.storage.put(entry, this.deps.vault.readBlob(entry), cancellation);
    }
  }
}

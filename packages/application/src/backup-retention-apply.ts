import { BackupFailure, planRetention } from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type {
  AgentCatalog,
  AgentLease,
  AgentPlan,
  CatalogEntry,
  MaintainedVault,
  VaultListing,
  VaultLock,
} from './backup-agent-ports.js';

export interface RetentionDependencies {
  readonly vault: MaintainedVault;
  readonly catalog: AgentCatalog;
  readonly plan: AgentPlan;
  readonly lock: VaultLock;
  /** Storage id of this instance: points of other sources are never deleted. */
  readonly sourceInstanceId: string;
}
export interface RetentionOutcome {
  readonly forgotten: number;
  readonly blobs: number;
  readonly bytes: string;
}

/** Fails as soon as any of the sources is cancelled. */
export function anyCancellation(...sources: readonly Cancellation[]): Cancellation {
  return {
    throwIfAborted() {
      for (const source of sources) source.throwIfAborted();
    },
  };
}

/**
 * Catalog follows the vault, the source of truth. New rows get the bytes they add over the
 * previous point of this source (a sorted merge of two inventories), an estimate of what their
 * capture copied; rows written by the agent at capture time keep the exact value.
 */
export async function syncCatalog(
  deps: Pick<RetentionDependencies, 'vault' | 'catalog' | 'sourceInstanceId'>,
  lease: AgentLease,
  listing: VaultListing,
  cancellation: Cancellation,
): Promise<{ readonly points: number; readonly damaged: number }> {
  const vaultId = listing.identity.vaultId;
  const own = listing.committed
    .filter((manifest) => manifest.sourceInstanceId === deps.sourceInstanceId)
    .sort((a, b) => Date.parse(a.snapshot.takenAt) - Date.parse(b.snapshot.takenAt));
  const known = await deps.catalog.known(vaultId);
  const forgotten = await deps.catalog.forgotten(vaultId);
  const added: CatalogEntry[] = [];
  let previous: BackupManifest | undefined;
  for (const manifest of own) {
    cancellation.throwIfAborted();
    if (!known.has(manifest.pointId)) {
      const shared = previous ? await deps.vault.sharedBytes(manifest, previous, cancellation) : 0n;
      const newBytes = BigInt(manifest.inventory.contentBytes) - shared;
      added.push({ manifest, newBytes: newBytes.toString() });
    }
    previous = manifest;
  }
  // A directory without COMMITTED is ours to finish when its row is marked forgotten.
  const damaged = [
    ...listing.damaged,
    ...listing.uncommitted.filter((pointId) => !forgotten.has(pointId)),
  ];
  await deps.catalog.reconcile(lease, vaultId, {
    added,
    present: own.map((manifest) => manifest.pointId),
    damaged,
  });
  return { points: own.length, damaged: damaged.length };
}

/**
 * Retention apply (ADR 0056) under the exclusive vault lock: catalog sync, completion of
 * deletions an earlier apply began, forget of points outside the policy, then prune. Each step
 * is repeatable, so a crash at any point is repaired by the next apply. The catalog mark comes
 * before the vault change: a pin set meanwhile wins, and the mark tells a later apply that a
 * directory without COMMITTED is an unfinished forget rather than damage.
 */
export class ApplyBackupRetention {
  constructor(private readonly deps: RetentionDependencies) {}

  run(lease: AgentLease, cancellation: Cancellation): Promise<RetentionOutcome> {
    return this.deps.lock.exclusive(async (held) => {
      const cancel = anyCancellation(cancellation, held, lease);
      const { vault, catalog } = this.deps;
      const listing = await vault.listing();
      const vaultId = listing.identity.vaultId;
      await syncCatalog(this.deps, lease, listing, cancel);
      const marked = await catalog.forgotten(vaultId);
      let forgotten = 0;
      for (const pointId of [
        ...listing.uncommitted,
        ...listing.committed.map((manifest) => manifest.pointId),
      ])
        if (marked.has(pointId)) {
          cancel.throwIfAborted();
          await vault.forget(pointId);
          forgotten++;
        }
      forgotten += await this.forgetOutsidePolicy(lease, listing, marked, cancel);
      const after = await vault.listing();
      const pending = await catalog.forgotten(vaultId);
      // Content of a damaged point cannot be known; keep every blob until an operator decides.
      if (after.damaged.length || after.uncommitted.some((pointId) => !pending.has(pointId)))
        throw new BackupFailure('invalid_manifest', 'Vault holds a damaged point; prune skipped');
      const pruned = await vault.prune(after.committed, cancel);
      return { forgotten, blobs: pruned.blobs, bytes: pruned.bytes.toString() };
    });
  }

  private async forgetOutsidePolicy(
    lease: AgentLease,
    listing: VaultListing,
    marked: ReadonlySet<string>,
    cancellation: Cancellation,
  ): Promise<number> {
    const { vault, catalog, sourceInstanceId } = this.deps;
    const vaultId = listing.identity.vaultId;
    const own = new Set(
      listing.committed
        .filter((manifest) => manifest.sourceInstanceId === sourceInstanceId)
        .map((manifest) => manifest.pointId)
        .filter((pointId) => !marked.has(pointId)),
    );
    const plan = await this.deps.plan.read();
    // A point that failed verification neither leaves nor displaces a healthy one.
    const candidates = (await catalog.live(vaultId)).filter(
      (point) => own.has(point.id) && point.verifyError === null,
    );
    const decision = planRetention(candidates, plan.retention, plan.timezone);
    let forgotten = 0;
    for (const { id } of decision.delete) {
      cancellation.throwIfAborted();
      if (!(await catalog.forget(lease, vaultId, id))) continue;
      await vault.forget(id);
      forgotten++;
    }
    return forgotten;
  }
}

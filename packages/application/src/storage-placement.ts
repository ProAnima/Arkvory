import {
  ArkvoryError,
  authorizeAction,
  decidePlacement,
  parsePlacementUpdate,
} from '@proanima/arkvory-domain';
import type {
  BackendWriteState,
  MutationAccess,
  PlacementContext,
  PlacementDecision,
  Principal,
  StorageRoutingRule,
} from '@proanima/arkvory-domain';

/** The placement policy of one repository (ADR 0083, N11); revision 0 and no rules if unset. */
export interface PlacementPolicy {
  readonly repository: string;
  readonly revision: number;
  readonly rules: readonly StorageRoutingRule[];
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
}

export interface PlacementPolicies {
  get(repository: string): Promise<PlacementPolicy>;
  /** Compare-and-swap on the revision: a stale `expectedRevision` is `revision_mismatch`. */
  save(
    access: MutationAccess,
    expectedRevision: number,
    rules: readonly StorageRoutingRule[],
  ): Promise<PlacementPolicy>;
}

/** The storages of this process and whether each takes new data now. */
export interface StorageBackendStates {
  /** Configured ids in a stable order, the core's `default` first. */
  ids(): readonly string[];
  state(backendId: string): BackendWriteState;
  /** Storages on record that are not configured: their uploads cannot be served. */
  unconfigured?(): readonly string[];
}

/**
 * Chooses the storage of a new upload and answers whether an upload's storage still takes new
 * bytes (StorageService). It only decides: it never moves data.
 */
export interface UploadPlacement {
  place(context: PlacementContext): Promise<PlacementDecision>;
  state(backendId: string): BackendWriteState;
}

/** The repository's rules applied to the current state of the storages. */
export class PolicyPlacement implements UploadPlacement {
  constructor(
    private readonly policies: Pick<PlacementPolicies, 'get'>,
    private readonly backends: StorageBackendStates,
    /** Told of every fallback to the core's storage, for metrics and logs; must not throw. */
    private readonly fellBack: (decision: PlacementDecision, repository: string) => void = () =>
      undefined,
  ) {}

  async place(context: PlacementContext): Promise<PlacementDecision> {
    const policy = await this.policies.get(context.repository);
    const decision = decidePlacement(policy.rules, context, (id) => this.backends.state(id));
    if (decision.fallback !== null) this.fellBack(decision, context.repository);
    return decision;
  }

  state(backendId: string): BackendWriteState {
    return this.backends.state(backendId);
  }
}

export interface PlacementView extends PlacementPolicy {
  /** Every configured storage with its state in the answering process. */
  readonly backends: readonly { readonly id: string; readonly state: BackendWriteState }[];
}

/** The wire lists at most this many storages. */
const MAX_LISTED_BACKENDS = 64;

/** `GET|PUT /api/v1/repositories/{r}/storage/placement`. */
export class PlacementControl {
  constructor(
    private readonly policies: PlacementPolicies,
    private readonly backends: StorageBackendStates,
  ) {}

  async get(principal: Principal, repository: string): Promise<PlacementView> {
    authorizeAction(principal, repository, 'storage.read', null);
    return this.view(await this.policies.get(repository));
  }

  /**
   * A rule may only name a configured storage; whether it takes new data now does not matter,
   * since a storage that does not is skipped at each upload. Existing data never moves.
   */
  async save(principal: Principal, repository: string, value: unknown): Promise<PlacementView> {
    authorizeAction(principal, repository, 'storage.manage', null);
    const { expectedRevision, rules } = parsePlacementUpdate(value);
    const known = new Set(this.backends.ids());
    const unknown = rules.findIndex((rule) => !known.has(rule.backendId));
    if (unknown >= 0)
      throw new ArkvoryError('invalid_input', 'Unknown storage backend', {
        reason: 'backend_unknown',
        details: [{ field: `/rules/${String(unknown)}/backendId`, problem: 'invalid' }],
      });
    const saved = await this.policies.save(
      { principal, repository, actions: ['storage.manage'] },
      expectedRevision,
      rules,
    );
    return this.view(saved);
  }

  /** Configured storages, then those on record but no longer configured (`not_loaded`). */
  private view(policy: PlacementPolicy): PlacementView {
    const configured = this.backends.ids().map((id) => ({ id, state: this.backends.state(id) }));
    const removed = (this.backends.unconfigured?.() ?? []).map((id) => ({
      id,
      state: 'not_loaded' as const,
    }));
    return { ...policy, backends: [...configured, ...removed].slice(0, MAX_LISTED_BACKENDS) };
  }
}

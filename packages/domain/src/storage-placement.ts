import { ArkvoryError } from './artifact.js';
import { retentionObject, annotationRevision } from './retention.js';
import { DEFAULT_STORAGE_BACKEND } from './backup-manifest.js';
import { matchRoutingRule } from './storage-routing.js';
import type { StorageRoutingRule } from './storage-routing.js';

/** Id of a storage instance (ADR 0083, N11): `default`, `volume-2`, `<module>.<name>`. */
export const STORAGE_BACKEND_ID = /^(?=.{1,64}$)[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;
export const MAX_PLACEMENT_RULES = 32;
const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A package group, a `prefix/*` of groups or `*`; no control characters. */
const PACKAGE_GROUP = /^(\*|[^\s*\p{Cc}][^*\p{Cc}]{0,254}(\/\*)?)$/u;
const BYTES = /^(0|[1-9][0-9]{0,15})$/;

/**
 * Why a storage cannot take new data now. `accepting` is the only state that receives new
 * uploads; every other state sends them to the core's storage (ADR 0078, L4):
 * - `not_loaded`: no instance with this id in this process (unknown, removed from the config);
 * - `disabled`: configured but switched off;
 * - `unavailable`: configured and enabled but failed to open or stopped answering;
 * - `read_only`: serves reads and checks only, refuses every write;
 * - `not_accepting`: works, finishes what it holds, but takes no new data (draining).
 */
export const BACKEND_WRITE_STATES = [
  'accepting',
  'not_loaded',
  'disabled',
  'unavailable',
  'read_only',
  'not_accepting',
] as const;
export type BackendWriteState = (typeof BACKEND_WRITE_STATES)[number];
export type PlacementFallback = Exclude<BackendWriteState, 'accepting'>;

export interface PlacementDecision {
  /** Where the upload is created. */
  readonly backendId: string;
  /** What the policy chose; equals `backendId` unless the choice fell back. */
  readonly requested: string;
  readonly fallback: PlacementFallback | null;
}

export interface PlacementContext {
  readonly repository: string;
  readonly packageGroup?: string | undefined;
  readonly size: number;
}

/**
 * The storage of a new upload: the first matching rule, else the core's storage. A chosen
 * storage that does not accept new data sends the upload to the core's storage instead of
 * failing it: placement never stops a publication. The core's storage itself never falls back;
 * if it cannot write, the write fails as it always did.
 */
export function decidePlacement(
  rules: readonly StorageRoutingRule[],
  context: PlacementContext,
  state: (backendId: string) => BackendWriteState,
): PlacementDecision {
  const rule = rules.find((candidate) => matchRoutingRule(candidate, context));
  const requested = rule?.backendId ?? DEFAULT_STORAGE_BACKEND;
  if (requested === DEFAULT_STORAGE_BACKEND)
    return { backendId: requested, requested, fallback: null };
  const current = state(requested);
  return current === 'accepting'
    ? { backendId: requested, requested, fallback: null }
    : { backendId: DEFAULT_STORAGE_BACKEND, requested, fallback: current };
}

function invalid(field: string): never {
  throw new ArkvoryError('invalid_input', 'Invalid storage placement', {
    reason: 'validation',
    details: [{ field, problem: 'invalid' }],
  });
}

function rule(value: unknown, index: number): StorageRoutingRule {
  const at = `/rules/${String(index)}`;
  const row = retentionObject(value, ['id', 'backendId', 'packageGroup', 'minSizeBytes']);
  const { id, backendId, packageGroup, minSizeBytes } = row;
  if (typeof id !== 'string' || !RULE_ID.test(id)) invalid(`${at}/id`);
  if (typeof backendId !== 'string' || !STORAGE_BACKEND_ID.test(backendId))
    invalid(`${at}/backendId`);
  if (
    packageGroup !== null &&
    (typeof packageGroup !== 'string' || !PACKAGE_GROUP.test(packageGroup))
  )
    invalid(`${at}/packageGroup`);
  if (minSizeBytes !== null && (typeof minSizeBytes !== 'string' || !BYTES.test(minSizeBytes)))
    invalid(`${at}/minSizeBytes`);
  const bytes = minSizeBytes === null ? undefined : Number(minSizeBytes);
  if (bytes !== undefined && !Number.isSafeInteger(bytes)) invalid(`${at}/minSizeBytes`);
  return {
    id,
    backendId,
    ...(packageGroup === null ? {} : { packageGroup }),
    ...(bytes === undefined ? {} : { minSizeBytes: bytes }),
  };
}

/**
 * Rules in their wire and stored form: `{id, backendId, packageGroup, minSizeBytes}` with
 * `null` for an absent condition and the size as a decimal string. The repository of a rule is
 * the repository of its policy, so rules carry none.
 */
export function parsePlacementRules(value: unknown): readonly StorageRoutingRule[] {
  if (!Array.isArray(value) || value.length > MAX_PLACEMENT_RULES) invalid('/rules');
  const rules = value.map((entry: unknown, index) => rule(entry, index));
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) invalid('/rules');
  return rules;
}

export interface PlacementRuleWire {
  readonly id: string;
  readonly backendId: string;
  readonly packageGroup: string | null;
  readonly minSizeBytes: string | null;
}

export function placementRulesWire(rules: readonly StorageRoutingRule[]): PlacementRuleWire[] {
  return rules.map((entry) => ({
    id: entry.id,
    backendId: entry.backendId,
    packageGroup: entry.packageGroup ?? null,
    minSizeBytes: entry.minSizeBytes === undefined ? null : String(entry.minSizeBytes),
  }));
}

/** `{expectedRevision, rules}` of `PUT …/storage/placement`. */
export function parsePlacementUpdate(value: unknown): {
  readonly expectedRevision: number;
  readonly rules: readonly StorageRoutingRule[];
} {
  const row = retentionObject(value, ['expectedRevision', 'rules']);
  return {
    expectedRevision: annotationRevision(row['expectedRevision']),
    rules: parsePlacementRules(row['rules']),
  };
}

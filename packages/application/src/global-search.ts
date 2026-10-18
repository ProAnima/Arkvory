import {
  ArkvoryError,
  authorizeAction,
  fieldError,
  repositoryPattern,
  requireStage,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { effectivePermissions } from './effective-permissions.js';
import type { ArtifactSearchItem } from './catalog-ports.js';

/** Bounds of the installation-wide search (ADR 0081, A1; query bounds of ADR 0075). */
export const GLOBAL_SEARCH_REPOSITORIES = 1000;
const MAX_REPOSITORY_FILTER = 100;
const MAX_LABELS = 8;
const MAX_QUERY = 240;
const MAX_CURSOR = 160;

/**
 * Keyset position of a result: publication time in microseconds since the epoch (reservation
 * time for rows without one), then repository and id. Ordered by time descending, the rest
 * ascending in byte order.
 */
export interface GlobalSearchPosition {
  readonly micros: string;
  readonly repository: string;
  readonly id: string;
}
export type GlobalSearchItem = ArtifactSearchItem & { readonly repository: string };
export interface GlobalSearchRow {
  readonly item: GlobalSearchItem;
  readonly position: GlobalSearchPosition;
}
export interface GlobalSearchFilter {
  /** Already authorized, unique, sorted; never empty. */
  readonly repositories: readonly string[];
  readonly query: string;
  readonly labels: readonly string[];
  readonly stage: string | undefined;
  readonly after: GlobalSearchPosition | undefined;
}
export interface GlobalSearchStore {
  /** At most `limit` available artifacts in keyset order, strictly after `filter.after`. */
  searchRepositories(
    filter: GlobalSearchFilter,
    limit: number,
  ): Promise<readonly GlobalSearchRow[]>;
}
/** Raw query parameters; every value is unknown until checked here. */
export interface GlobalSearchInput {
  readonly q?: unknown;
  readonly repositories?: unknown;
  readonly labels?: unknown;
  readonly stage?: unknown;
  readonly after?: unknown;
  readonly limit?: unknown;
}
export interface GlobalSearchPage {
  readonly items: readonly GlobalSearchItem[];
  readonly next: string | null;
}

const repository = new RegExp(repositoryPattern);
const label = /^[\p{L}\p{N}_.:-]{1,64}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const micros = /^-?(0|[1-9][0-9]{0,18})$/;

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw fieldError(field, 'type', `Invalid ${field}`);
  return value;
}
function list(value: unknown, field: string, limit: number, pattern: RegExp): readonly string[] {
  const raw = optionalText(value, field);
  if (raw === undefined || raw === '') return [];
  const entries = raw.split(',');
  if (entries.length > limit) throw fieldError(field, 'length', `Too many ${field}`);
  if (entries.some((entry) => !pattern.test(entry)))
    throw fieldError(field, 'format', `Invalid ${field}`);
  return [...new Set(entries)].sort();
}
function pageSize(value: unknown): number {
  const raw = optionalText(value, 'limit');
  if (raw === undefined) return 50;
  if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 100)
    throw fieldError('limit', 'range', 'Search page limit must be between 1 and 100');
  return Number(raw);
}

/** The cursor is opaque to clients; its form is `<micros>.<repository>.<id>`. */
export function encodeSearchCursor(position: GlobalSearchPosition): string {
  return `${position.micros}.${position.repository}.${position.id}`;
}
export function decodeSearchCursor(value: string): GlobalSearchPosition {
  const parts = value.split('.');
  const [time = '', name = '', id = ''] = parts;
  // A forged time beyond the exact range of the SQL comparison (year 1684 to 2255) would fail
  // in the database as a server error; it is refused here like any malformed cursor.
  if (
    value.length > MAX_CURSOR ||
    parts.length !== 3 ||
    !micros.test(time) ||
    !Number.isSafeInteger(Number(time)) ||
    !repository.test(name) ||
    !uuid.test(id)
  )
    throw fieldError('after', 'format', 'Invalid search cursor');
  return { micros: time, repository: name, id };
}

/**
 * Repositories this principal may list, by name, at most GLOBAL_SEARCH_REPOSITORIES; with
 * `only`, just those of them (the cap then never hides a named repository). Each one passes the
 * same check as the repository search route, so the result never names a repository that route
 * would refuse. Nothing here reads the catalog: an absent and an unreadable name cost the same.
 */
export function listableRepositories(
  principal: Principal,
  only?: readonly string[],
  cap: number = GLOBAL_SEARCH_REPOSITORIES,
): readonly string[] {
  const names = new Set<string>();
  for (const binding of effectivePermissions(principal))
    if (
      binding.actions.includes('artifact.list') &&
      (only === undefined || only.includes(binding.resource.id))
    )
      names.add(binding.resource.id);
  const allowed: string[] = [];
  for (const name of [...names].sort()) {
    if (allowed.length >= cap) break;
    try {
      authorizeAction(principal, name, 'artifact.list', ['read']);
      allowed.push(name);
    } catch (error) {
      if (!(error instanceof ArkvoryError)) throw error;
    }
  }
  return allowed;
}

/** `GET /api/v1/search`: one bounded keyset query over the repositories the caller may list. */
export class GlobalSearch {
  constructor(private readonly store: GlobalSearchStore) {}
  async search(principal: Principal, input: GlobalSearchInput): Promise<GlobalSearchPage> {
    return this.searchIn(input, (requested) => listableRepositories(principal, requested));
  }

  /**
   * One search with the rights of several principals at once (ADR 0083, N4): only repositories
   * every one of them may list. An empty list of principals sees nothing.
   */
  async searchAll(
    principals: readonly Principal[],
    input: GlobalSearchInput,
  ): Promise<GlobalSearchPage> {
    return this.searchIn(input, (requested) => {
      const [first, ...others] = principals;
      if (first === undefined) return [];
      // Intersected before the cap: a repository all may list is never cut by the order of
      // the principals or by the first one's other repositories.
      const all = (p: Principal) => listableRepositories(p, requested, Number.POSITIVE_INFINITY);
      const each = others.map((p) => new Set(all(p)));
      return all(first)
        .filter((name) => each.every((names) => names.has(name)))
        .slice(0, GLOBAL_SEARCH_REPOSITORIES);
    });
  }

  private async searchIn(
    input: GlobalSearchInput,
    listable: (requested: readonly string[] | undefined) => readonly string[],
  ): Promise<GlobalSearchPage> {
    const query = optionalText(input.q, 'q') ?? '';
    if (query.length > MAX_QUERY) throw fieldError('q', 'length', 'Search text too long');
    // PostgreSQL text cannot hold NUL; the statement would fail as a server error.
    if (query.includes('\0')) throw fieldError('q', 'format', 'Invalid search text');
    const requested = list(input.repositories, 'repositories', MAX_REPOSITORY_FILTER, repository);
    const labels = list(input.labels, 'labels', MAX_LABELS, label);
    const rawStage = optionalText(input.stage, 'stage');
    const stage = rawStage === undefined ? undefined : requireStageField(rawStage);
    const rawAfter = optionalText(input.after, 'after');
    const after = rawAfter === undefined ? undefined : decodeSearchCursor(rawAfter);
    const limit = pageSize(input.limit);
    // An unreadable repository in the filter is dropped like an absent one: the answer is the
    // same either way, so the filter cannot be used to learn which repositories exist.
    const repositories = listable(requested.length ? requested : undefined);
    if (repositories.length === 0) return { items: [], next: null };
    const rows = await this.store.searchRepositories(
      { repositories, query, labels, stage, after },
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => row.item),
      next: rows.length > limit && last ? encodeSearchCursor(last.position) : null,
    };
  }
}
function requireStageField(value: string): string {
  try {
    return requireStage(value);
  } catch {
    throw fieldError('stage', 'format', 'Invalid promotion stage');
  }
}

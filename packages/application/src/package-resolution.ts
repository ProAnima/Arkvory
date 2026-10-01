import {
  authorizeAction,
  ArkvoryError,
  parseSemVer,
  parseVersionRange,
  requireStage,
  satisfies,
} from '@proanima/arkvory-domain';
import type { Principal, VersionRange } from '@proanima/arkvory-domain';
import type { StageStore } from './promotion.js';

export interface PackageCandidate {
  readonly group: string;
  readonly name: string;
  readonly version: string;
  readonly artifactId: string;
  readonly sha256: string;
  readonly size: string;
  readonly publishedAt: string;
  /** Present when the query filters by stage. */
  readonly stagedAt: string | null;
}
export interface PackageQuery {
  readonly group: string;
  readonly name: string;
  readonly version?: string;
  readonly range?: string;
  readonly stage?: string;
  readonly prerelease: boolean;
  readonly order: 'version' | 'promoted';
}
export interface PackageCandidateStore {
  /** Live registered versions ordered by SemVer or, with a stage, by promotion time; newest first. */
  candidates(
    repository: string,
    query: Pick<PackageQuery, 'group' | 'name' | 'stage' | 'order'>,
    offset: number,
    limit: number,
  ): Promise<readonly PackageCandidate[]>;
  exact(
    repository: string,
    query: Pick<PackageQuery, 'group' | 'name' | 'stage'> & { version: string },
  ): Promise<PackageCandidate | null>;
}

const keys = ['group', 'name', 'version', 'range', 'stage', 'prerelease', 'order'];
const text = (value: unknown, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new ArkvoryError('invalid_input', 'Invalid package query');
  return value;
};

export function parsePackageQuery(value: unknown): PackageQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Invalid package query');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown package query option');
  const name = text(input['name'], 128);
  if (!name) throw new ArkvoryError('invalid_input', 'Package name is required');
  const version = text(input['version'], 128);
  const range = text(input['range'], 256);
  if (version !== undefined && range !== undefined)
    throw new ArkvoryError('invalid_input', 'Use either version or range');
  const stage = input['stage'] === undefined ? undefined : requireStage(input['stage']);
  const prerelease = input['prerelease'];
  if (prerelease !== undefined && prerelease !== 'true' && prerelease !== 'false')
    throw new ArkvoryError('invalid_input', 'prerelease must be true or false');
  const order = input['order'] ?? 'version';
  if (order !== 'version' && order !== 'promoted')
    throw new ArkvoryError('invalid_input', 'order must be version or promoted');
  if (order === 'promoted' && stage === undefined)
    throw new ArkvoryError('invalid_input', 'order=promoted requires a stage');
  const group = input['group'] === '' ? '' : (text(input['group'], 128) ?? '');
  return {
    group,
    name,
    ...(version === undefined ? {} : { version }),
    ...(range === undefined ? {} : { range }),
    ...(stage === undefined ? {} : { stage }),
    prerelease: prerelease === 'true',
    order,
  };
}

/** Candidates scanned before a range query reports no match; bounds work for one request. */
const SCAN_LIMIT = 10000;

export interface ResolvedPackage extends PackageCandidate {
  readonly stages: readonly string[];
}

export class PackageResolver {
  constructor(
    private readonly store: PackageCandidateStore,
    private readonly stageStore: Pick<StageStore, 'stages'>,
  ) {}

  /** Content downloads need only content.read, so deploy keys can fetch without catalog access. */
  async resolve(
    p: Principal,
    repository: string,
    value: unknown,
    permission: 'package.read' | 'content.read' = 'package.read',
  ): Promise<ResolvedPackage> {
    authorizeAction(p, repository, permission, ['read']);
    const query = parsePackageQuery(value);
    const found = query.version
      ? await this.store.exact(repository, { ...query, version: query.version })
      : await this.scan(repository, query, query.range ? parseVersionRange(query.range) : [[]]);
    if (!found) throw new ArkvoryError('not_found', 'No package version matches the query');
    const stages = await this.stageStore.stages(repository, found.artifactId);
    return { ...found, stages: stages.map((entry) => entry.stage) };
  }

  private async scan(repository: string, query: PackageQuery, range: VersionRange) {
    for (let offset = 0; offset < SCAN_LIMIT; offset += 200) {
      const page = await this.store.candidates(repository, query, offset, 200);
      for (const candidate of page) {
        const version = parseSemVer(candidate.version);
        if (version && satisfies(version, range, query.prerelease)) return candidate;
      }
      if (page.length < 200) return null;
    }
    return null;
  }
}

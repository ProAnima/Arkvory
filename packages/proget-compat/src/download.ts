import { DepotError, requireAssetPath } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import type { ArtifactCatalog } from '@proanima/depot-application';

/** Documented original-archive download subset; transformations are deliberately rejected. */
export class ProGetDownloads {
  constructor(private readonly catalog: ArtifactCatalog) {}
  async common(principal: Principal, repository: string, query: unknown): Promise<string> {
    if (typeof query !== 'object' || query === null || Array.isArray(query))
      throw new DepotError('invalid_input', 'Invalid package identifiers');
    const params: Record<string, unknown> = Object.fromEntries(Object.entries(query));
    if (Object.keys(params).some((key) => !['group', 'name', 'version'].includes(key)))
      throw new DepotError('invalid_input', 'Unsupported package identifier');
    const { group = '', name, version } = params;
    if (
      typeof group !== 'string' ||
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof version !== 'string' ||
      version.length === 0
    )
      throw new DepotError('invalid_input', 'Group, name and version must identify one package');
    const packages = await this.catalog.packages(principal, repository, group, name);
    const selected = packages.find((item) => item.version.toLowerCase() === version.toLowerCase());
    if (!selected) throw new DepotError('not_found', 'Package not found');
    return selected.artifactId;
  }
  async universal(
    principal: Principal,
    repository: string,
    path: string,
    query: unknown,
  ): Promise<string> {
    if (typeof query !== 'object' || query === null || Array.isArray(query))
      throw new DepotError('invalid_input', 'Invalid query');
    const params: Record<string, unknown> = Object.fromEntries(Object.entries(query));
    if (Object.keys(params).some((key) => !['latest', 'key'].includes(key)))
      throw new DepotError('invalid_input', 'Unsupported download option');
    const segments = requireAssetPath(path).split('/');
    const latest = params['latest'] !== undefined;
    const version = latest ? undefined : segments.pop();
    const name = segments.pop();
    const group = segments.join('/');
    if (!name || (!latest && !version))
      throw new DepotError('invalid_input', 'Specify package version or latest');
    const packages = await this.catalog.packages(principal, repository, group, name);
    const selected = latest
      ? packages[0]
      : packages.find((item) => item.version.toLowerCase() === version?.toLowerCase());
    if (!selected) throw new DepotError('not_found', 'Package not found');
    return selected.artifactId;
  }
  async asset(principal: Principal, repository: string, path: string): Promise<string> {
    return (await this.catalog.asset(principal, repository, path)).artifactId;
  }
}

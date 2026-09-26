import { ArkvoryError, requireAssetPath } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ArtifactCatalog } from '@proanima/arkvory-application';

/** Documented original-archive download subset; transformations are deliberately rejected. */
export class ProGetDownloads {
  constructor(private readonly catalog: ArtifactCatalog) {}
  async common(principal: Principal, repository: string, query: unknown): Promise<string> {
    if (typeof query !== 'object' || query === null || Array.isArray(query))
      throw new ArkvoryError('invalid_input', 'Invalid package identifiers');
    const params: Record<string, unknown> = Object.fromEntries(Object.entries(query));
    if (Object.keys(params).some((key) => !['group', 'name', 'version'].includes(key)))
      throw new ArkvoryError('invalid_input', 'Unsupported package identifier');
    const { group = '', name, version } = params;
    if (
      typeof group !== 'string' ||
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof version !== 'string' ||
      version.length === 0
    )
      throw new ArkvoryError('invalid_input', 'Group, name and version must identify one package');
    const id = await this.catalog.resolvePackage(principal, repository, group, name, version);
    if (!id) throw new ArkvoryError('not_found', 'Package not found');
    return id;
  }
  async universal(
    principal: Principal,
    repository: string,
    path: string,
    query: unknown,
  ): Promise<string> {
    if (typeof query !== 'object' || query === null || Array.isArray(query))
      throw new ArkvoryError('invalid_input', 'Invalid query');
    const params: Record<string, unknown> = Object.fromEntries(Object.entries(query));
    if (Object.keys(params).some((key) => !['latest', 'key'].includes(key)))
      throw new ArkvoryError('invalid_input', 'Unsupported download option');
    const segments = requireAssetPath(path).split('/');
    const latest = params['latest'] !== undefined;
    const version = latest ? undefined : segments.pop();
    const name = segments.pop();
    const group = segments.join('/');
    if (!name || (!latest && !version))
      throw new ArkvoryError('invalid_input', 'Specify package version or latest');
    const id = await this.catalog.resolvePackage(principal, repository, group, name, version);
    if (!id) throw new ArkvoryError('not_found', 'Package not found');
    return id;
  }
  async asset(principal: Principal, repository: string, path: string): Promise<string> {
    return (await this.catalog.resolveAssetContent(principal, repository, path)).artifactId;
  }
}

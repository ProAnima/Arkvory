import { requireRepository } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
export interface ServiceKey {
  readonly sha256: string;
  readonly principal: Principal;
}

export function parseKeys(value: unknown): readonly ServiceKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw new Error('Key file must contain between 1 and 1000 service keys');
  const keys: ServiceKey[] = [];
  const entries: readonly unknown[] = value;
  for (const item of entries) {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid service key entry');
    const entry: Record<string, unknown> = Object.fromEntries(Object.entries(item));
    const {
      id,
      sha256,
      repositories,
      permissions,
      administrator = false,
      serviceAdministrator = false,
    } = entry;
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(id) ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Array.isArray(repositories) ||
      !Array.isArray(permissions) ||
      typeof administrator !== 'boolean' ||
      typeof serviceAdministrator !== 'boolean'
    )
      throw new Error('Invalid service key entry');
    const repos: string[] = [];
    for (const repository of repositories) {
      if (typeof repository !== 'string') throw new Error('Invalid repository scope');
      repos.push(requireRepository(repository));
    }
    const grants: ('read' | 'write')[] = [];
    const rawPermissions: readonly unknown[] = permissions;
    for (const permission of rawPermissions) {
      if (permission !== 'read' && permission !== 'write') throw new Error('Invalid permission');
      grants.push(permission);
    }
    if (keys.some((key) => key.sha256 === sha256)) throw new Error('Duplicate service key hash');
    keys.push({
      sha256,
      principal: {
        id,
        repositories: repos,
        permissions: grants,
        administrator,
        serviceAdministrator,
      },
    });
  }
  return keys;
}

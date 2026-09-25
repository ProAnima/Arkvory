import type { Principal, ServiceAction, ServiceBinding } from '@proanima/depot-domain';
import { serviceActions } from '@proanima/depot-domain';

// Frozen mapping of existing coarse permissions. New actions require explicit opt-in.
const legacyActions: Readonly<
  Record<
    Exclude<
      ServiceAction,
      'repository.read' | 'artifact.delete' | 'storage.read' | 'storage.manage' | 'diagnostics.read'
    >,
    readonly ('read' | 'write')[]
  >
> = {
  'artifact.read': ['read'],
  'artifact.list': ['read'],
  'content.read': ['read'],
  'upload.create': ['write'],
  'upload.read': ['write'],
  'upload.write': ['write'],
  'upload.complete': ['write'],
  'upload.cancel': ['write'],
  'job.read': ['write'],
  'package.read': ['read'],
  'package.publish': ['read', 'write'],
  'asset.read': ['read'],
  'asset.write': ['read', 'write'],
  'asset.restore': ['read', 'write'],
  'annotation.read': ['read'],
  'annotation.write': ['read', 'write'],
  'reference.write': ['read', 'write'],
  'audit.read': ['write'],
};
export function effectivePermissions(principal: Principal): readonly ServiceBinding[] {
  if (principal.managed) return principal.managed.bindings;
  const coarse = new Map<string, Set<'read' | 'write'>>();
  const grants =
    principal.grants ??
    principal.repositories.map((repository) => ({
      repository,
      permissions: principal.permissions,
    }));
  for (const grant of grants) {
    const permissions = coarse.get(grant.repository) ?? new Set<'read' | 'write'>();
    for (const permission of grant.permissions) permissions.add(permission);
    coarse.set(grant.repository, permissions);
  }
  const result: ServiceBinding[] = [];
  for (const repository of new Set([
    ...principal.repositories,
    ...grants.map((g) => g.repository),
  ])) {
    const granted = coarse.get(repository);
    if (!granted?.size) continue;
    const actions = serviceActions.filter(
      (action) =>
        action !== 'repository.read' &&
        action !== 'artifact.delete' &&
        action !== 'storage.read' &&
        action !== 'storage.manage' &&
        action !== 'diagnostics.read' &&
        legacyActions[action].every((permission) => granted.has(permission)),
    );
    if (actions.length) result.push({ resource: { kind: 'repository', id: repository }, actions });
  }
  return result;
}

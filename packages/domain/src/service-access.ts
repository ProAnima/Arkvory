import { authorize, ArkvoryError, requireRepository, requireWritable } from './artifact.js';
import type { Principal } from './artifact.js';

import { serviceActions } from './service-policy.js';
import type { ServiceAction, ServiceBinding } from './service-policy.js';
/** Actions that never change a repository; every other action is refused in a mirror. */
const readActions: ReadonlySet<ServiceAction> = new Set([
  'repository.read',
  'storage.read',
  'diagnostics.read',
  'artifact.read',
  'artifact.list',
  'content.read',
  'upload.read',
  'job.read',
  'package.read',
  'asset.read',
  'annotation.read',
  'audit.read',
]);
function action(value: unknown): ServiceAction {
  const found = serviceActions.find((item) => item === value);
  if (!found) throw new ArkvoryError('invalid_input', 'Unknown service permission');
  return found;
}
export function parseBindings(value: unknown): readonly ServiceBinding[] {
  if (!Array.isArray(value) || value.length > 64)
    throw new ArkvoryError('invalid_input', 'At most 64 bindings allowed');
  const entries: readonly unknown[] = value;
  const result: ServiceBinding[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new ArkvoryError('invalid_input', 'Invalid binding');
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(entry));
    if (Object.keys(row).some((key) => !['resource', 'actions'].includes(key)))
      throw new ArkvoryError('invalid_input', 'Unknown binding field');
    const resource = row['resource'];
    if (typeof resource !== 'object' || resource === null || Array.isArray(resource))
      throw new ArkvoryError('invalid_input', 'Invalid resource');
    const r: Record<string, unknown> = Object.fromEntries(Object.entries(resource));
    if (
      r['kind'] !== 'repository' ||
      typeof r['id'] !== 'string' ||
      Object.keys(r).some((key) => !['kind', 'id'].includes(key))
    )
      throw new ArkvoryError('invalid_input', 'Only exact repository bindings are supported');
    const actions = row['actions'];
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > serviceActions.length)
      throw new ArkvoryError('invalid_input', 'Invalid actions');
    const values: readonly unknown[] = actions;
    result.push({
      resource: { kind: 'repository', id: requireRepository(r['id']) },
      actions: [...new Set(values.map(action))].sort(),
    });
  }
  return result.sort((a, b) => a.resource.id.localeCompare(b.resource.id));
}
export function allows(
  bindings: readonly ServiceBinding[],
  repository: string,
  permission: ServiceAction,
): boolean {
  return bindings.some((b) => b.resource.id === repository && b.actions.includes(permission));
}
export function intersectBindings(
  account: readonly ServiceBinding[],
  key: readonly ServiceBinding[],
): readonly ServiceBinding[] {
  return key
    .map((binding) => ({
      ...binding,
      actions: binding.actions.filter((permission) =>
        allows(account, binding.resource.id, permission),
      ),
    }))
    .filter((binding) => binding.actions.length > 0);
}
export function requireSubset(
  requested: readonly ServiceBinding[],
  ceiling: readonly ServiceBinding[],
): void {
  if (
    requested.some((b) =>
      b.actions.some((permission) => !allows(ceiling, b.resource.id, permission)),
    )
  )
    throw new ArkvoryError('forbidden', 'Key permissions exceed the account or rotation policy', {
      reason: 'permission_missing',
    });
}
export function authorizeAction(
  principal: Principal,
  repository: string,
  permission: ServiceAction,
  legacy: readonly ('read' | 'write')[] | null,
): void {
  requireRepository(repository);
  if (principal.managed) {
    if (!allows(principal.managed.bindings, repository, permission))
      throw new ArkvoryError('forbidden', 'Service permission denied', {
        reason: 'permission_missing',
      });
    if (!readActions.has(permission)) requireWritable(principal, repository);
  } else {
    if (legacy === null || legacy.length === 0)
      throw new ArkvoryError('forbidden', 'Explicit managed permission required', {
        reason: 'permission_missing',
      });
    for (const p of legacy) authorize(principal, repository, p);
  }
}

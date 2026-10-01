import type { OperationPolicy } from './operation-policy.js';

export const apiSurfaces = [
  'discovery',
  'identity',
  'catalog',
  'transfers',
  'administration',
  'operations',
] as const;
export type ApiSurface = (typeof apiSurfaces)[number];
export const apiVisibilities = [
  'public',
  'authenticated',
  'self',
  'repository',
  'owned-resource',
  'delegated',
  'bootstrap',
  'administrator',
] as const;
export type ApiVisibility = (typeof apiVisibilities)[number];

/** Contract classification only. This metadata never authorizes a request. */
export function apiClassification(policy: OperationPolicy): {
  surface: ApiSurface;
  visibility: ApiVisibility;
} {
  const access = policy.access;
  let visibility: ApiVisibility;
  switch (access.kind) {
    case 'public':
      visibility = 'public';
      break;
    case 'authenticated':
      visibility = policy.tag === 'Identity' ? 'self' : 'authenticated';
      break;
    case 'account-session':
    case 'pending-or-active-key':
    case 'bootstrap-or-own-key':
      visibility = 'self';
      break;
    case 'administrator':
      visibility = 'administrator';
      break;
    case 'service-bootstrap':
      visibility = 'bootstrap';
      break;
    case 'service-administration':
      visibility = 'delegated';
      break;
    case 'repository-discovery':
      visibility = 'repository';
      break;
    case 'repository':
      visibility = access.owner ? 'owned-resource' : 'repository';
      break;
  }
  let surface: ApiSurface;
  switch (policy.tag) {
    case 'Updates':
      surface = 'administration';
      break;
    case 'System':
      surface =
        policy.operationId.startsWith('getReadiness') ||
        policy.operationId.startsWith('getLiveness') ||
        policy.operationId.startsWith('getMetrics')
          ? 'operations'
          : 'discovery';
      break;
    case 'Repositories':
      surface = 'discovery';
      break;
    case 'Identity':
      surface = access.kind === 'administrator' ? 'administration' : 'identity';
      break;
    case 'Services':
      surface = access.kind === 'pending-or-active-key' ? 'identity' : 'administration';
      break;
    case 'Catalog':
      surface = 'catalog';
      break;
    case 'Content':
    case 'Uploads':
      surface = 'transfers';
      break;
    default:
      throw new Error(`Unclassified API responsibility: ${policy.tag}`);
  }
  return { surface, visibility };
}

import { authorizeAction, ArkvoryError } from '@proanima/arkvory-domain';
import type {
  Principal,
  ServiceAction,
  ServiceDelegation,
  AdministrationAction,
} from '@proanima/arkvory-domain';
import { repositoryCard } from './repositories.js';

/** Minimum facts required to project a catalog of callable operations. Not an authorization port. */
export type ApiAccessRequirement =
  | {
      kind:
        | 'public'
        | 'authenticated'
        | 'account-session'
        | 'administrator'
        | 'service-bootstrap'
        | 'bootstrap-or-own-key'
        | 'pending-or-active-key';
    }
  | { kind: 'service-administration'; action: AdministrationAction }
  | { kind: 'repository-discovery'; resource: 'visible-repositories' | 'path.repository' }
  | {
      kind: 'repository';
      actions: readonly ServiceAction[];
      legacy: readonly ('read' | 'write')[] | null;
    };

export function operationVisible(
  principal: Principal,
  requirement: ApiAccessRequirement,
  repository: string | undefined,
  delegations: readonly ServiceDelegation[],
): boolean {
  const bootstrap = !principal.managed && principal.serviceAdministrator === true;
  switch (requirement.kind) {
    case 'public':
    case 'authenticated':
      return true;
    case 'administrator':
      return !principal.managed && principal.administrator === true;
    case 'account-session':
      return !principal.managed && principal.id.startsWith('user:');
    case 'service-bootstrap':
      return bootstrap;
    case 'bootstrap-or-own-key':
      return bootstrap || !!principal.managed;
    case 'pending-or-active-key':
      return !!principal.managed;
    case 'service-administration':
      return (
        bootstrap ||
        delegations.some(
          (grant) =>
            grant.enabled &&
            grant.keyId === principal.managed?.keyId &&
            grant.actions.includes(requirement.action),
        )
      );
    case 'repository-discovery':
      if (requirement.resource === 'visible-repositories') return true;
      if (!repository) return false;
      try {
        repositoryCard(principal, repository);
        return true;
      } catch (error) {
        if (error instanceof ArkvoryError && error.code === 'not_found') return false;
        throw error;
      }
    case 'repository':
      if (!repository) return false;
      try {
        for (const action of requirement.actions)
          authorizeAction(principal, repository, action, requirement.legacy);
        return true;
      } catch (error) {
        if (error instanceof ArkvoryError && error.code === 'forbidden') return false;
        throw error;
      }
  }
}

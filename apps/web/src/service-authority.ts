import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { AdministrationPermission, ServiceBindingResponse } from '@proanima/arkvory-contracts';
export type Delegation = Awaited<ReturnType<ArkvoryClient['serviceDelegations']>>[number];
export class ServiceAuthority {
  constructor(
    readonly bootstrap: boolean,
    readonly writable: boolean,
    readonly delegations: readonly Delegation[],
  ) {}
  allows(id: string, action: AdministrationPermission) {
    if (action.endsWith('.manage') && !this.writable) return false;
    return (
      this.bootstrap ||
      this.delegations.some(
        (d) => d.enabled && d.targetAccountId === id && d.actions.includes(action),
      )
    );
  }
  covers(id: string, bindings: readonly ServiceBindingResponse[]) {
    if (this.bootstrap) return true;
    const grant = this.delegations.find((d) => d.enabled && d.targetAccountId === id);
    return (
      !!grant &&
      bindings.every((b) =>
        b.actions.every((a) =>
          grant.ceiling.some((c) => c.resource.id === b.resource.id && c.actions.includes(a)),
        ),
      )
    );
  }
}

import type { IdentityApi } from './identity-api.js';
import type { UsersApi } from './users-api.js';
import type { ServiceAccountsApi } from './service-accounts-api.js';
import type { CredentialsApi } from './credentials-api.js';
type ManagementTransport = Pick<
  IdentityApi,
  | 'login'
  | 'register'
  | 'logout'
  | 'me'
  | 'permissions'
  | 'changePassword'
  | 'activateServiceKey'
  | 'tokens'
  | 'createToken'
  | 'revokeToken'
> &
  Pick<
    UsersApi,
    | 'users'
    | 'createUser'
    | 'updateUser'
    | 'accessGroups'
    | 'createAccessGroup'
    | 'setGroupMember'
    | 'setGroupGrant'
  > &
  Pick<
    ServiceAccountsApi,
    | 'serviceAccounts'
    | 'serviceAccount'
    | 'createServiceAccount'
    | 'updateServiceAccount'
    | 'servicePolicy'
    | 'setServicePolicy'
    | 'serviceAudit'
    | 'serviceKeys'
  > &
  Pick<
    CredentialsApi,
    | 'serviceKey'
    | 'issueServiceKey'
    | 'rotateServiceKey'
    | 'revokeServiceKey'
    | 'serviceDelegations'
    | 'setServiceDelegation'
    | 'removeServiceDelegation'
  >;

/** Responsibility namespaces retain the exact existing transport signatures and authorization. */
export function managementClients(client: ManagementTransport) {
  return {
    identity: Object.freeze({
      login: client.login.bind(client),
      register: client.register.bind(client),
      logout: client.logout.bind(client),
      me: client.me.bind(client),
      permissions: client.permissions.bind(client),
      changePassword: client.changePassword.bind(client),
      activateKey: client.activateServiceKey.bind(client),
      tokens: client.tokens.bind(client),
      createToken: client.createToken.bind(client),
      revokeToken: client.revokeToken.bind(client),
    }),
    administration: Object.freeze({
      users: Object.freeze({
        list: client.users.bind(client),
        create: client.createUser.bind(client),
        update: client.updateUser.bind(client),
      }),
      groups: Object.freeze({
        list: client.accessGroups.bind(client),
        create: client.createAccessGroup.bind(client),
        setMember: client.setGroupMember.bind(client),
        setGrant: client.setGroupGrant.bind(client),
      }),
      services: Object.freeze({
        list: client.serviceAccounts.bind(client),
        get: client.serviceAccount.bind(client),
        create: client.createServiceAccount.bind(client),
        update: client.updateServiceAccount.bind(client),
        policy: client.servicePolicy.bind(client),
        setPolicy: client.setServicePolicy.bind(client),
        keys: client.serviceKeys.bind(client),
        audit: client.serviceAudit.bind(client),
      }),
      credentials: Object.freeze({
        get: client.serviceKey.bind(client),
        issue: client.issueServiceKey.bind(client),
        rotate: client.rotateServiceKey.bind(client),
        revoke: client.revokeServiceKey.bind(client),
        delegations: client.serviceDelegations.bind(client),
        setDelegation: client.setServiceDelegation.bind(client),
        removeDelegation: client.removeServiceDelegation.bind(client),
      }),
    }),
  };
}
export type IdentityClient = ReturnType<typeof managementClients>['identity'];
export type AdministrationClient = ReturnType<typeof managementClients>['administration'];

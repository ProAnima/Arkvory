import { IdentityApi } from './identity-api.js';
import { UsersApi } from './users-api.js';
import { ServiceAccountsApi } from './service-accounts-api.js';
import { CredentialsApi } from './credentials-api.js';
import type { HttpPort } from './http-transport.js';

/**
 * Sign-in, accounts, groups, service accounts and their keys of the flat client API.
 * ArkvoryClient extends it, so callers keep calling these methods on the client itself.
 */
export class AccountClient {
  private readonly authentication: IdentityApi;
  private readonly usersApi: UsersApi;
  private readonly services: ServiceAccountsApi;
  private readonly credentials: CredentialsApi;
  constructor(http: HttpPort) {
    this.authentication = new IdentityApi(http);
    this.usersApi = new UsersApi(http);
    this.services = new ServiceAccountsApi(http);
    this.credentials = new CredentialsApi(http);
  }
  login(...args: Parameters<IdentityApi['login']>) {
    return this.authentication.login(...args);
  }
  register(...args: Parameters<IdentityApi['register']>) {
    return this.authentication.register(...args);
  }
  permissions(...args: Parameters<IdentityApi['permissions']>) {
    return this.authentication.permissions(...args);
  }
  activateServiceKey(...args: Parameters<IdentityApi['activateServiceKey']>) {
    return this.authentication.activateServiceKey(...args);
  }
  me(...args: Parameters<IdentityApi['me']>) {
    return this.authentication.me(...args);
  }
  logout(...args: Parameters<IdentityApi['logout']>) {
    return this.authentication.logout(...args);
  }
  changePassword(...args: Parameters<IdentityApi['changePassword']>) {
    return this.authentication.changePassword(...args);
  }
  tokens(...args: Parameters<IdentityApi['tokens']>) {
    return this.authentication.tokens(...args);
  }
  createToken(...args: Parameters<IdentityApi['createToken']>) {
    return this.authentication.createToken(...args);
  }
  revokeToken(...args: Parameters<IdentityApi['revokeToken']>) {
    return this.authentication.revokeToken(...args);
  }
  authOptions(...args: Parameters<IdentityApi['authOptions']>) {
    return this.authentication.authOptions(...args);
  }
  accountTokens(...args: Parameters<UsersApi['accountTokens']>) {
    return this.usersApi.accountTokens(...args);
  }
  revokeAccountToken(...args: Parameters<UsersApi['revokeAccountToken']>) {
    return this.usersApi.revokeAccountToken(...args);
  }
  securityAudit(...args: Parameters<UsersApi['securityAudit']>) {
    return this.usersApi.securityAudit(...args);
  }
  users(...args: Parameters<UsersApi['users']>) {
    return this.usersApi.users(...args);
  }
  createUser(...args: Parameters<UsersApi['createUser']>) {
    return this.usersApi.createUser(...args);
  }
  updateUser(...args: Parameters<UsersApi['updateUser']>) {
    return this.usersApi.updateUser(...args);
  }
  accessGroups(...args: Parameters<UsersApi['accessGroups']>) {
    return this.usersApi.accessGroups(...args);
  }
  createAccessGroup(...args: Parameters<UsersApi['createAccessGroup']>) {
    return this.usersApi.createAccessGroup(...args);
  }
  setGroupMember(...args: Parameters<UsersApi['setGroupMember']>) {
    return this.usersApi.setGroupMember(...args);
  }
  setGroupGrant(...args: Parameters<UsersApi['setGroupGrant']>) {
    return this.usersApi.setGroupGrant(...args);
  }
  serviceAccounts(...args: Parameters<ServiceAccountsApi['serviceAccounts']>) {
    return this.services.serviceAccounts(...args);
  }
  servicePolicy(...args: Parameters<ServiceAccountsApi['servicePolicy']>) {
    return this.services.servicePolicy(...args);
  }
  serviceAccount(...args: Parameters<ServiceAccountsApi['serviceAccount']>) {
    return this.services.serviceAccount(...args);
  }
  createServiceAccount(...args: Parameters<ServiceAccountsApi['createServiceAccount']>) {
    return this.services.createServiceAccount(...args);
  }
  updateServiceAccount(...args: Parameters<ServiceAccountsApi['updateServiceAccount']>) {
    return this.services.updateServiceAccount(...args);
  }
  setServicePolicy(...args: Parameters<ServiceAccountsApi['setServicePolicy']>) {
    return this.services.setServicePolicy(...args);
  }
  serviceKeys(...args: Parameters<ServiceAccountsApi['serviceKeys']>) {
    return this.services.serviceKeys(...args);
  }
  serviceAudit(...args: Parameters<ServiceAccountsApi['serviceAudit']>) {
    return this.services.serviceAudit(...args);
  }
  serviceDelegations(...args: Parameters<CredentialsApi['serviceDelegations']>) {
    return this.credentials.serviceDelegations(...args);
  }
  setServiceDelegation(...args: Parameters<CredentialsApi['setServiceDelegation']>) {
    return this.credentials.setServiceDelegation(...args);
  }
  removeServiceDelegation(...args: Parameters<CredentialsApi['removeServiceDelegation']>) {
    return this.credentials.removeServiceDelegation(...args);
  }
  serviceKey(...args: Parameters<CredentialsApi['serviceKey']>) {
    return this.credentials.serviceKey(...args);
  }
  issueServiceKey(...args: Parameters<CredentialsApi['issueServiceKey']>) {
    return this.credentials.issueServiceKey(...args);
  }
  rotateServiceKey(...args: Parameters<CredentialsApi['rotateServiceKey']>) {
    return this.credentials.rotateServiceKey(...args);
  }
  revokeServiceKey(...args: Parameters<CredentialsApi['revokeServiceKey']>) {
    return this.credentials.revokeServiceKey(...args);
  }
}

/** Administrator-only account, group and security journal operations under /api/v1. */
export const accountAdministrationOperations = [
  ['/users', 'get', 'listUsers'],
  ['/users', 'post', 'createUser'],
  ['/users/{id}', 'patch', 'updateUser'],
  ['/users/{id}/tokens', 'get', 'listAccountTokens'],
  ['/users/{id}/tokens/{tokenId}', 'delete', 'revokeAccountToken'],
  ['/security/audit', 'get', 'listSecurityAudit'],
  ['/access-groups', 'get', 'listAccessGroups'],
  ['/access-groups', 'post', 'createAccessGroup'],
  ['/access-groups/{id}/members/{userId}', 'put', 'addGroupMember'],
  ['/access-groups/{id}/members/{userId}', 'delete', 'removeGroupMember'],
  ['/access-groups/{id}/grants/{repository}', 'put', 'setGroupGrant'],
  ['/access-groups/{id}/grants/{repository}', 'delete', 'removeGroupGrant'],
] as const;

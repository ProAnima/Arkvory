import { items, record, text } from './responses.js';

export interface AccountResponse {
  id: string;
  name: string;
  administrator: boolean;
  enabled: boolean;
}
export interface GroupResponse {
  id: string;
  name: string;
  members: readonly string[];
  grants: readonly { repository: string; access: 'read' | 'write' }[];
}
export interface LoginResponse {
  token: string;
  expiresAt: string;
  account: AccountResponse;
}
export interface PrincipalResponse {
  id: string;
  administrator: boolean;
  grants: readonly {
    repository: string;
    permissions: readonly ('read' | 'write')[];
  }[];
}
export function readPrincipal(value: unknown): PrincipalResponse {
  const row = record(value);
  if (typeof row['administrator'] !== 'boolean') throw new Error('Invalid account role');
  const grants = items(row['grants']).map((value) => {
    const grant = record(value);
    const repository = text(grant['repository']);
    if (!repository) throw new Error('Invalid repository grant');
    const permissions = items(grant['permissions']).map((value) => {
      if (value !== 'read' && value !== 'write') throw new Error('Invalid repository permission');
      return value;
    });
    if (permissions.length === 0) throw new Error('Empty repository grant');
    return { repository, permissions };
  });
  if (new Set(grants.map((grant) => grant.repository)).size !== grants.length)
    throw new Error('Duplicate repository grant');
  return { id: text(row['id']), administrator: row['administrator'], grants };
}
export function readAccount(value: unknown): AccountResponse {
  const row = record(value);
  if (typeof row['administrator'] !== 'boolean' || typeof row['enabled'] !== 'boolean')
    throw new Error('Invalid account state');
  return {
    id: text(row['id']),
    name: text(row['name']),
    administrator: row['administrator'],
    enabled: row['enabled'],
  };
}
export function readGroup(value: unknown): GroupResponse {
  const row = record(value);
  return {
    id: text(row['id']),
    name: text(row['name']),
    members: items(row['members']).map(text),
    grants: items(row['grants']).map((value) => {
      const grant = record(value);
      if (grant['access'] !== 'read' && grant['access'] !== 'write')
        throw new Error('Invalid group access');
      return { repository: text(grant['repository']), access: grant['access'] };
    }),
  };
}
export function readLogin(value: unknown): LoginResponse {
  const row = record(value);
  return {
    token: text(row['token']),
    expiresAt: text(row['expiresAt']),
    account: readAccount(row['account']),
  };
}

export interface UserTokenResponse {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface CreatedUserTokenResponse extends UserTokenResponse {
  token: string;
}

export function readUserToken(value: unknown): UserTokenResponse {
  const row = record(value);
  return {
    id: text(row['id']),
    name: text(row['name']),
    prefix: text(row['prefix']),
    createdAt: text(row['createdAt']),
    expiresAt:
      row['expiresAt'] === null || row['expiresAt'] === undefined ? null : text(row['expiresAt']),
    lastUsedAt:
      row['lastUsedAt'] === null || row['lastUsedAt'] === undefined
        ? null
        : text(row['lastUsedAt']),
    revoked: typeof row['revoked'] === 'boolean' ? row['revoked'] : false,
  };
}

export function readCreatedUserToken(value: unknown): CreatedUserTokenResponse {
  const row = record(value);
  const base = readUserToken(value);
  return {
    ...base,
    token: text(row['token']),
  };
}

export interface PackageResponse {
  group: string;
  name: string;
  version: string;
  artifactId: string;
  manifest: Readonly<Record<string, unknown>>;
}
export interface PackageGroupResponse {
  group: string;
  name: string | null;
  items: readonly PackageResponse[];
}
export function readPackage(value: unknown): PackageResponse {
  const row = record(value);
  return {
    group: text(row['group']),
    name: text(row['name']),
    version: text(row['version']),
    artifactId: text(row['artifactId']),
    manifest: record(row['manifest']),
  };
}
export function readPackageList(value: unknown): {
  items: readonly PackageResponse[];
  groups: readonly PackageGroupResponse[];
  next: string | null;
} {
  const row = record(value);
  const packages = items(row['items']).map(readPackage);
  const byId = new Map(packages.map((item) => [item.artifactId, item]));
  const next = row['next'] === null ? null : text(row['next']);
  return {
    items: packages,
    next,
    groups: items(row['groups']).map((value) => {
      const group = record(value);
      return {
        group: text(group['group']),
        name: group['name'] === null ? null : text(group['name']),
        items: items(group['artifactIds']).map((value) => {
          const item = byId.get(text(value));
          if (!item) throw new Error('Invalid package group reference');
          return item;
        }),
      };
    }),
  };
}

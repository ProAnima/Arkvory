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

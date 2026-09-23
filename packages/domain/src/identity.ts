import { DepotError, requireRepository } from './artifact.js';

export function requireAccountName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(value))
    throw new DepotError('invalid_input', 'Invalid account name');
  return value;
}

export function requireGroupName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{2,64}$/.test(value))
    throw new DepotError('invalid_input', 'Invalid group name');
  return value;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new DepotError('invalid_input', 'Password must contain 12 to 128 characters');
  return value;
}

export function requireGrant(repository: unknown, access: unknown) {
  if (typeof repository !== 'string') throw new DepotError('invalid_input', 'Invalid repository');
  requireRepository(repository);
  if (access !== 'read' && access !== 'write')
    throw new DepotError('invalid_input', 'Invalid repository access');
  return { repository, access } as const;
}

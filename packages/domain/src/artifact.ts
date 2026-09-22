export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'capacity_exceeded'
  | 'integrity_mismatch'
  | 'busy'
  | 'unavailable';

export class DepotError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DepotError';
  }
}

export interface ArtifactDescriptor {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly labels: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Upload {
  readonly id: string;
  readonly repository: string;
  readonly owner: string;
  readonly descriptor: ArtifactDescriptor;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'available' | 'cancelled';
}

export const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
export const repositoryPattern = '^[a-z0-9][a-z0-9_-]{0,63}$';
export const idPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export function requireRepository(value: string): string {
  if (!new RegExp(repositoryPattern).test(value))
    throw new DepotError('invalid_input', 'Invalid repository');
  return value;
}

export function requireId(value: string): string {
  if (!new RegExp(idPattern).test(value))
    throw new DepotError('invalid_input', 'Invalid upload identifier');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Expected an object');
  return Object.fromEntries(Object.entries(value));
}

export function parseDescriptor(value: unknown): ArtifactDescriptor {
  const input = record(value);
  if (Object.keys(input).some((k) => !['name', 'size', 'sha256', 'labels', 'metadata'].includes(k)))
    throw new DepotError('invalid_input', 'Unknown artifact property');
  const { name, size, sha256 } = input;
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 240 ||
    name.includes('/') ||
    name.includes('\\') ||
    Array.from({ length: name.length }, (_, index) => name.charCodeAt(index)).some(
      (code) => code < 32 || code === 127,
    ) ||
    name === '.' ||
    name === '..'
  )
    throw new DepotError('invalid_input', 'Invalid file name');
  if (
    typeof size !== 'string' ||
    !/^(0|[1-9][0-9]{0,15})$/.test(size) ||
    Number(size) > MAX_OBJECT_BYTES
  )
    throw new DepotError('invalid_input', 'Size must be a decimal string between 0 and 5368709120');
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
    throw new DepotError('invalid_input', 'Invalid SHA-256');
  const labels: unknown = input['labels'] ?? [];
  if (!Array.isArray(labels) || labels.length > 32)
    throw new DepotError('invalid_input', 'At most 32 labels allowed');
  const checkedLabels: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string' || !/^[\p{L}\p{N}_.:-]{1,64}$/u.test(label))
      throw new DepotError('invalid_input', 'Invalid label');
    checkedLabels.push(label);
  }
  const metadata = record(input['metadata'] ?? {});
  if (Object.keys(metadata).length > 32)
    throw new DepotError('invalid_input', 'At most 32 metadata fields allowed');
  const checkedMetadata: Record<string, string> = {};
  for (const key of Object.keys(metadata).sort()) {
    const entry = metadata[key];
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      typeof entry !== 'string' ||
      entry.length > 1024
    )
      throw new DepotError('invalid_input', 'Invalid metadata field');
    checkedMetadata[key] = entry;
  }
  return {
    name,
    size: Number(size),
    sha256,
    labels: [...new Set(checkedLabels)].sort(),
    metadata: checkedMetadata,
  };
}

export function descriptorWire(descriptor: ArtifactDescriptor): Record<string, unknown> {
  return { ...descriptor, size: String(descriptor.size) };
}

export function sameDescriptor(left: ArtifactDescriptor, right: ArtifactDescriptor): boolean {
  return JSON.stringify(descriptorWire(left)) === JSON.stringify(descriptorWire(right));
}

export interface Principal {
  readonly id: string;
  readonly repositories: readonly string[];
  readonly permissions: readonly ('read' | 'write')[];
}

export function authorize(
  principal: Principal,
  repository: string,
  permission: 'read' | 'write',
): void {
  requireRepository(repository);
  if (!principal.repositories.includes(repository) || !principal.permissions.includes(permission))
    throw new DepotError('forbidden', 'Repository access denied');
}

import type { ManagedCredential, ServiceAction } from './service-policy.js';
import { MAX_OBJECT_BYTES } from './object-size.js';
import type { CredentialKind, TokenScope } from './credentials.js';

export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'unauthorized'
  | 'capacity_exceeded'
  | 'integrity_mismatch'
  | 'busy'
  | 'unavailable'
  /** Unclassified server defect: 500 without Retry-After; clients must not retry blindly. */
  | 'internal';

export class ArkvoryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArkvoryError';
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
  readonly storageBackend?: string;
  /** Multipart segment size chosen at creation; whole-file uploads ignore it. */
  readonly partBytes?: number;
}

export const repositoryPattern = '^[a-z0-9][a-z0-9_-]{0,63}$';
export const idPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export function requireRepository(value: string): string {
  if (!new RegExp(repositoryPattern).test(value))
    throw new ArkvoryError('invalid_input', 'Invalid repository');
  return value;
}

export function requireId(value: string): string {
  if (!new RegExp(idPattern).test(value))
    throw new ArkvoryError('invalid_input', 'Invalid upload identifier');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Expected an object');
  return Object.fromEntries(Object.entries(value));
}

export function parseDescriptor(value: unknown): ArtifactDescriptor {
  const input = record(value);
  if (Object.keys(input).some((k) => !['name', 'size', 'sha256', 'labels', 'metadata'].includes(k)))
    throw new ArkvoryError('invalid_input', 'Unknown artifact property');
  const { name, size, sha256 } = input;
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 240 ||
    /[\uD800-\uDFFF]/u.test(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    Array.from({ length: name.length }, (_, index) => name.charCodeAt(index)).some(
      (code) => code < 32 || code === 127,
    ) ||
    name === '.' ||
    name === '..'
  )
    throw new ArkvoryError('invalid_input', 'Invalid file name');
  if (
    typeof size !== 'string' ||
    !/^(0|[1-9][0-9]{0,15})$/.test(size) ||
    Number(size) > MAX_OBJECT_BYTES
  )
    throw new ArkvoryError(
      'invalid_input',
      `Size must be a decimal string between 0 and ${String(MAX_OBJECT_BYTES)}`,
    );
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
    throw new ArkvoryError('invalid_input', 'Invalid SHA-256');
  const labels: unknown = input['labels'] ?? [];
  if (!Array.isArray(labels) || labels.length > 32)
    throw new ArkvoryError('invalid_input', 'At most 32 labels allowed');
  const checkedLabels: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string' || !/^[\p{L}\p{N}_.:-]{1,64}$/u.test(label))
      throw new ArkvoryError('invalid_input', 'Invalid label');
    checkedLabels.push(label);
  }
  const metadata = record(input['metadata'] ?? {});
  if (Object.keys(metadata).length > 32)
    throw new ArkvoryError('invalid_input', 'At most 32 metadata fields allowed');
  const checkedMetadata: Record<string, string> = {};
  for (const key of Object.keys(metadata).sort()) {
    const entry = metadata[key];
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      typeof entry !== 'string' ||
      entry.length > 1024 ||
      entry.includes('\u0000') ||
      // Unicode mode matches unpaired surrogates only; valid supplementary characters survive.
      /[\uD800-\uDFFF]/u.test(entry)
    )
      throw new ArkvoryError('invalid_input', 'Invalid metadata field');
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
  /** Every producer declares how the caller authenticated; policies must not guess from IDs. */
  readonly credential: CredentialKind;
  /** Present only for personal tokens; grants are already narrowed to this scope. */
  readonly tokenScope?: TokenScope;
  readonly managed?: ManagedCredential;
  readonly serviceAdministrator?: boolean;
  readonly id: string;
  readonly repositories: readonly string[];
  readonly permissions: readonly ('read' | 'write')[];
  readonly grants?: readonly {
    readonly repository: string;
    readonly permissions: readonly ('read' | 'write')[];
  }[];
  readonly administrator?: boolean;
  /**
   * Correlation ID of the request (or job) this principal was resolved for. Set only by a
   * composition root; authorization never reads it. Audit and job adapters persist it.
   */
  readonly requestId?: string;
}

export function authorize(
  principal: Principal,
  repository: string,
  permission: 'read' | 'write',
): void {
  if (principal.managed) throw new ArkvoryError('forbidden', 'Explicit service action required');
  requireRepository(repository);
  const allowed = principal.grants
    ? principal.grants.some(
        (grant) => grant.repository === repository && grant.permissions.includes(permission),
      )
    : principal.repositories.includes(repository) && principal.permissions.includes(permission);
  if (!allowed) throw new ArkvoryError('forbidden', 'Repository access denied');
}

export interface MutationAccess {
  readonly principal: Principal;
  readonly repository: string;
  readonly actions: readonly ServiceAction[];
}

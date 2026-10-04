import { requireAssetPath } from './lifecycle.js';

/**
 * Git LFS rules (ADR 0065), free of HTTP and storage. An object is named by the SHA-256 of its
 * content (`oid`), which is exactly what Arkvory verifies for every artifact; locks name a file
 * path of the git repository.
 */
export class LfsError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'LfsError';
  }
}

const oidPattern = /^[a-f0-9]{64}$/;
/** Feed action of an object row: the detail is the oid, the artifact holds its bytes. */
export const lfsObjectAction = 'lfs.object';
/** Objects one batch may name; git-lfs sends at most 100 by default. */
export const MAX_LFS_BATCH_OBJECTS = 1000;

export const isLfsOid = (value: unknown): value is string =>
  typeof value === 'string' && oidPattern.test(value);

export interface LfsObjectRequest {
  readonly oid: string;
  readonly size: number;
}
export interface LfsBatchRequest {
  readonly operation: 'upload' | 'download';
  readonly objects: readonly LfsObjectRequest[];
}

function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new LfsError(422, 'Expected a JSON object');
  return Object.fromEntries(Object.entries(value));
}

/**
 * A batch request: the operation and its objects. Only the basic transfer and SHA-256 are
 * offered; a client asking for neither is refused rather than answered with another adapter.
 */
export function parseLfsBatch(value: unknown, maxObjectBytes: number): LfsBatchRequest {
  const body = fields(value);
  const operation = body['operation'];
  if (operation !== 'upload' && operation !== 'download')
    throw new LfsError(422, 'operation must be upload or download');
  const transfers = body['transfers'];
  if (transfers !== undefined && (!Array.isArray(transfers) || !transfers.includes('basic')))
    throw new LfsError(422, 'Only the basic transfer adapter is supported');
  const algorithm = body['hash_algo'];
  if (algorithm !== undefined && algorithm !== 'sha256')
    throw new LfsError(409, 'Only the sha256 hash algorithm is supported');
  const list = body['objects'];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_LFS_BATCH_OBJECTS)
    throw new LfsError(422, `objects must list 1 to ${String(MAX_LFS_BATCH_OBJECTS)} objects`);
  const items: readonly unknown[] = list;
  const objects = items.map((item) => {
    const object = fields(item);
    const { oid, size } = object;
    if (!isLfsOid(oid)) throw new LfsError(422, 'An object needs a SHA-256 oid');
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
      throw new LfsError(422, 'An object needs a non-negative integer size');
    if (size > maxObjectBytes) throw new LfsError(422, 'Object exceeds the maximum size');
    return { oid, size };
  });
  return { operation, objects };
}

/** A lock path: a file path of the git repository, under the same rules as file paths here. */
export function requireLockPath(value: unknown): string {
  if (typeof value !== 'string') throw new LfsError(422, 'path is required');
  try {
    return requireAssetPath(value);
  } catch {
    throw new LfsError(422, 'Invalid lock path');
  }
}

/** `refs/heads/…` as git-lfs sends it; locks are per repository, the ref is only reported. */
export function lfsRef(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const name = fields(value)['name'];
  if (typeof name !== 'string' || name.length > 1024 || /\p{Cc}/u.test(name))
    throw new LfsError(422, 'Invalid ref');
  return name;
}

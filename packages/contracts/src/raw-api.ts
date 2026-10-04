import { integer, record, text } from './wire-values.js';

/*
 * Raw files by path (ADR 0064): one request stores bytes at a file path, as `curl -T` or
 * PowerShell's Invoke-WebRequest -InFile do, and GET reads the current revision back. It is
 * the path history of the catalog (assets) with a single-request upload in front: every PUT of
 * new content adds a revision, the same content again adds none, so a retried CI step is safe.
 */
export const rawOperationPolicies = [
  [
    '/raw/{assetPath}',
    'put',
    'putRawFile',
    [
      'upload.create',
      'upload.write',
      'upload.complete',
      'asset.read',
      'asset.write',
      'artifact.read',
    ],
    ['write'],
    'idempotent',
  ],
  ['/raw/{assetPath}', 'get', 'downloadRawFile', ['content.read'], ['read'], 'read'],
] as const;

/** Optional on PUT: with it the bytes go to storage in one pass; without, they are staged. */
export const rawChecksumHeader = 'x-checksum-sha256';

export interface RawFileResponse {
  readonly path: string;
  /** Path revision that now names the content; unchanged when it held this content already. */
  readonly revision: number;
  /** False when the path held exactly these bytes and nothing was stored. */
  readonly created: boolean;
  readonly artifact: { readonly id: string; readonly size: string; readonly sha256: string };
}

export function readRawFile(value: unknown): RawFileResponse {
  const r = record(value);
  const artifact = record(r['artifact']);
  const size = text(artifact['size']);
  const sha256 = text(artifact['sha256']);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(size) || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('Invalid raw file artifact');
  const created = r['created'];
  if (typeof created !== 'boolean') throw new Error('Invalid raw file response');
  return {
    path: text(r['path']),
    revision: integer(r['revision']),
    created,
    artifact: { id: text(artifact['id']), size, sha256 },
  };
}

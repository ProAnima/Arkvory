import { openAsBlob } from 'node:fs';
import { resolve } from 'node:path';
import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { download } from './download.js';
import { digest, upload } from './upload.js';
import type { UploadInput } from './upload.js';

interface PathInput {
  client: ArkvoryClient;
  server: string;
  repository: string;
  /** File path in the repository (ADR 0064), e.g. builds/game/1.0/Game.zip. */
  assetPath: string;
  signal: AbortSignal;
  progress: (bytes: number, total: number) => void;
  requestTimeoutMs?: number;
}

async function current(client: ArkvoryClient, repository: string, path: string) {
  try {
    return await client.asset(repository, path);
  } catch (error) {
    if (error instanceof ArkvoryHttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * `arkvoryctl put FILE PATH`: the resumable upload of `upload` (checkpoint beside the file),
 * then the path's next revision. The same bytes already at the path upload nothing, so a
 * repeated CI step is cheap; a path changed meanwhile by someone else fails with
 * revision_mismatch instead of overwriting it.
 */
export async function putToPath(
  input: PathInput & Pick<UploadInput, 'path' | 'state' | 'label' | 'annotations'>,
) {
  const blob = await openAsBlob(resolve(input.path));
  const sha256 = await digest(blob, input.signal);
  const before = await current(input.client, input.repository, input.assetPath);
  if (before) {
    const existing = await input.client.artifact(input.repository, before.artifactId);
    if (existing.descriptor.sha256 === sha256 && existing.descriptor.size === String(blob.size))
      return {
        path: before.path,
        revision: before.revision,
        created: false,
        id: before.artifactId,
      };
  }
  const uploaded = await upload({ ...input, sha256 });
  const entry = await input.client.setAsset(
    input.repository,
    input.assetPath,
    uploaded.id,
    before?.revision ?? 0,
  );
  return { path: entry.path, revision: entry.revision, created: true, id: uploaded.id };
}

/** `arkvoryctl get PATH OUTPUT`: the current revision, through the verified, resumable download. */
export async function getFromPath(input: PathInput & { output: string }) {
  const entry = await input.client.asset(input.repository, input.assetPath);
  return download({ ...input, id: entry.artifactId });
}

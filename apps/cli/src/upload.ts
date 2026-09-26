import { openAsBlob } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { record, text, readUpload, readAnnotations } from '@proanima/arkvory-contracts';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { exists, exclusive, readJson, saveJson } from './local-files.js';
import { CliError } from './errors.js';

interface UploadInput {
  client: ArkvoryClient;
  server: string;
  repository: string;
  path: string;
  state?: string;
  annotations?: string;
  label?: string;
  signal: AbortSignal;
  progress: (bytes: number, total: number) => void;
  requestTimeoutMs?: number;
}
async function digest(blob: Blob, signal: AbortSignal) {
  const hash = createHash('sha256'),
    reader = blob.stream().getReader();
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) return hash.digest('hex');
      const bytes: unknown = chunk.value;
      if (!(bytes instanceof Uint8Array)) throw new CliError('invalid_file_stream');
      hash.update(bytes);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
export async function upload(input: UploadInput) {
  const path = resolve(input.path),
    state = resolve(input.state ?? path + '.arkvory-upload.json');
  if (state === path) throw new CliError('invalid_state_path');
  return exclusive(state, async () => {
    const blob = await openAsBlob(path);
    if (blob.size > 5 * 1024 ** 3) throw new CliError('file_too_large');
    const sha256 = await digest(blob, input.signal);
    const annotations = readAnnotations({
      revision: 0,
      labels: input.label ? [input.label] : [],
      metadata: {},
      collections: [],
      ...(input.annotations ? record(await readJson(input.annotations)) : {}),
    });
    const descriptor = {
      name: basename(path),
      size: String(blob.size),
      sha256,
      labels: annotations.labels,
      metadata: annotations.metadata,
    };
    let key: string = randomUUID();
    let id: string | undefined;
    if (await exists(state)) {
      const row = record(await readJson(state));
      if (
        row['format'] !== 1 ||
        row['kind'] !== 'upload' ||
        row['server'] !== input.server ||
        row['repository'] !== input.repository ||
        row['path'] !== path ||
        JSON.stringify(row['descriptor']) !== JSON.stringify(descriptor)
      )
        throw new CliError('checkpoint_mismatch', 6);
      const savedKey = text(row['key']);
      if (!/^[0-9a-f-]{36}$/.test(savedKey)) throw new CliError('invalid_checkpoint');
      key = savedKey;
      if (row['id'] !== undefined) id = text(row['id']);
    }
    const checkpoint = {
      format: 1,
      kind: 'upload',
      server: input.server,
      repository: input.repository,
      path,
      descriptor,
      key,
    };
    // Persist idempotency before the request: losing the create response must not duplicate bytes.
    await saveJson(state, { ...checkpoint, ...(id ? { id } : {}) });
    const session = id
      ? await input.client.status(
          input.repository,
          id,
          AbortSignal.any([input.signal, AbortSignal.timeout(input.requestTimeoutMs ?? 60000)]),
        )
      : await input.client.create(input.repository, key, descriptor, input.signal);
    const checked = readUpload(session);
    if (checked.descriptor.sha256 !== sha256 || checked.descriptor.size !== descriptor.size)
      throw new CliError('checkpoint_mismatch', 6);
    await saveJson(state, { ...checkpoint, id: session.id });
    const result = await input.client.resume(input.repository, session.id, blob, {
      signal: input.signal,
      onProgress: (bytes) => {
        input.progress(bytes, blob.size);
      },
    });
    // Retain the receipt so retrying the same command after a lost success is idempotent.
    return { ...result, checkpoint: state };
  });
}

import { compatiblePath } from './legacy-files.js';
import { openAsBlob } from 'node:fs';
import { open, link, unlink, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ArkvoryIntegrityError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { record } from '@proanima/arkvory-contracts';
import { exists, exclusive, readJson, saveJson, syncDirectory } from './local-files.js';
import { CliError } from './errors.js';

interface DownloadInput {
  client: ArkvoryClient;
  server: string;
  repository: string;
  id: string;
  output: string;
  signal: AbortSignal;
  progress: (bytes: number, total: number) => void;
  requestTimeoutMs?: number;
}
export async function download(input: DownloadInput) {
  const output = resolve(input.output),
    state = compatiblePath(output + '.arkvory-download.json', output + '.depot-download.json');
  return exclusive(state, async () => {
    if (await exists(output)) throw new CliError('destination_exists', 6);
    const partial =
      output + (state.endsWith('.depot-download.json') ? '.depot-part' : '.arkvory-part');
    const checkpoint = {
      format: 1,
      kind: 'download',
      server: input.server,
      repository: input.repository,
      id: input.id,
    };
    if (await exists(state)) {
      const saved = record(await readJson(state));
      for (const [key, value] of Object.entries(checkpoint))
        if (saved[key] !== value) throw new CliError('checkpoint_mismatch', 6);
    } else {
      if (await exists(partial)) throw new CliError('orphan_partial', 6);
      await saveJson(state, checkpoint);
    }
    if (!(await exists(partial))) {
      const created = await open(partial, 'wx', 0o600);
      await created.close();
    }
    if (!(await lstat(partial)).isFile()) throw new CliError('invalid_partial');
    const prefix = await openAsBlob(partial);
    const artifact = await input.client.artifact(
      input.repository,
      input.id,
      AbortSignal.any([input.signal, AbortSignal.timeout(input.requestTimeoutMs ?? 60000)]),
    );
    const total = Number(artifact.descriptor.size);
    if (prefix.size > total) {
      const invalid = await open(partial, 'r+');
      try {
        await invalid.truncate(0);
        await invalid.sync();
      } finally {
        await invalid.close();
      }
      throw new ArkvoryIntegrityError();
    }
    // The SDK hashes the entire immutable prefix before append opens, then verifies final SHA-256.
    const stream = await input.client.downloadVerified(input.repository, input.id, {
      prefix,
      signal: input.signal,
    });
    await appendVerified(stream, partial, prefix.size, total, input);
    input.signal.throwIfAborted();
    // Hard-link publication is atomic and refuses replacement. Staging is on the same volume.
    await link(partial, output);
    await syncDirectory(dirname(output));
    await unlink(partial);
    await unlink(state);
    return {
      id: input.id,
      path: output,
      size: artifact.descriptor.size,
      sha256: artifact.descriptor.sha256,
    };
  });
}
async function appendVerified(
  stream: ReadableStream<Uint8Array>,
  path: string,
  start: number,
  total: number,
  input: DownloadInput,
) {
  const reader = stream.getReader();
  let file;
  try {
    file = await open(path, 'r+');
  } catch (error) {
    await reader.cancel();
    reader.releaseLock();
    throw error;
  }
  let offset = start,
    durable = start;
  try {
    for (;;) {
      input.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      let written = 0;
      while (written < chunk.value.length) {
        const result = await file.write(chunk.value, written, chunk.value.length - written, offset);
        if (result.bytesWritten === 0) throw new CliError('disk_write_failed', 7);
        written += result.bytesWritten;
        offset += result.bytesWritten;
      }
      if (offset - durable >= 8 * 1024 ** 2) {
        await file.sync();
        durable = offset;
      }
      input.progress(offset, total);
    }
    await file.sync();
  } catch (error) {
    // A corrupt prefix cannot be retried forever. Disk errors retain only the last flushed prefix.
    if (error instanceof ArkvoryIntegrityError) await file.truncate(0);
    else await file.truncate(durable);
    await file.sync();
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await file.close();
  }
}

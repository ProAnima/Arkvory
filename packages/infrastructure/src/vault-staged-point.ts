import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BackupFailure,
  INVENTORY_FILE,
  manifestDocument,
  tableFileName,
} from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
import type { Cancellation, StagedPoint } from '@proanima/arkvory-application';
import { syncDirectory } from './fs-durability.js';
import type { FileCipher, VaultCipher, VaultFileKind } from './vault-crypto.js';
import { encodeLines, readLines, writeDurably } from './vault-files.js';

const never: Cancellation = { throwIfAborted() {} };

async function* once(chunk: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield chunk;
}

/** The only point file names a caller may address; anything else is refused before access. */
export function pointFileParts(name: string): readonly string[] {
  if (name === INVENTORY_FILE) return [INVENTORY_FILE];
  const table = /^tables\/(arkvory_[a-z0-9_]{1,55})\.ndjson$/.exec(name)?.[1];
  if (table !== undefined && tableFileName(table) === name) return ['tables', `${table}.ndjson`];
  throw new BackupFailure('unsafe_path', 'Unexpected point file name');
}

/** What a point file is: part of the key of its encryption (ADR 0070). */
export function pointFileKind(name: string): VaultFileKind {
  return name === INVENTORY_FILE ? 'inventory' : 'table';
}

/** The cipher of one file of a point; its name stays the same before and after the publishing rename. */
export function pointFileCipher(
  cipher: VaultCipher | null,
  pointId: string,
  name: string,
): FileCipher | undefined {
  return cipher?.forFile(pointFileKind(name), `${pointId}/${name}`);
}

export interface StagedPointOptions {
  readonly directory: string;
  readonly pointId: string;
  readonly maxLine: number;
  /** Null for a plain vault. */
  readonly cipher: VaultCipher | null;
  /** One directory rename: the vault publishes the point. */
  readonly publish: (directory: string, pointId: string) => Promise<'committed' | 'exists'>;
}

/** A point in progress inside points/.staging; invisible until its directory is renamed. */
export class StagedPointDirectory implements StagedPoint {
  private published = false;
  constructor(private readonly options: StagedPointOptions) {}

  async write(name: string, lines: AsyncIterable<string>, cancellation: Cancellation) {
    const { directory, pointId, cipher } = this.options;
    const fileCipher = pointFileCipher(cipher, pointId, name);
    return writeDurably(join(directory, ...pointFileParts(name)), encodeLines(lines), {
      cancellation,
      countLines: true,
      ...(fileCipher ? { cipher: fileCipher } : {}),
    });
  }

  lines(name: string, cancellation: Cancellation): AsyncIterable<string> {
    const { directory, pointId, cipher, maxLine } = this.options;
    const fileCipher = pointFileCipher(cipher, pointId, name);
    return readLines(join(directory, ...pointFileParts(name)), {
      maxLine,
      cancellation,
      ...(fileCipher ? { cipher: fileCipher } : {}),
    });
  }

  async commit(manifest: BackupManifest): Promise<'committed' | 'exists'> {
    const { directory, pointId, cipher } = this.options;
    if (manifest.pointId !== pointId) throw new BackupFailure('unexpected', 'Wrong point');
    const text = Buffer.from(JSON.stringify(manifestDocument(manifest), null, 2) + '\n');
    const manifestCipher = cipher?.forFile('manifest', `${pointId}/manifest.json`);
    const written = await writeDurably(join(directory, 'manifest.json'), once(text), {
      cancellation: never,
      ...(manifestCipher ? { cipher: manifestCipher } : {}),
    });
    // COMMITTED binds the directory to this exact manifest (its content) and is written last.
    const record = { pointId, manifestSha256: written.sha256 };
    await writeDurably(
      join(directory, 'COMMITTED'),
      once(Buffer.from(JSON.stringify(record) + '\n')),
      { cancellation: never },
    );
    await syncDirectory(directory);
    const outcome = await this.options.publish(directory, pointId);
    this.published = outcome === 'committed';
    return outcome;
  }

  async discard(): Promise<void> {
    if (this.published) return;
    await rm(this.options.directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Plain content digest of a manifest document: what COMMITTED records. */
export function manifestDigest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

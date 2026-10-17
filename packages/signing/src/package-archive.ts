import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { SigningError } from './errors.js';
import { PACKAGE_LIMITS } from './package-manifest.js';
import {
  EntryNames,
  FILES_DIRECTORY,
  MANIFEST_FILE,
  SIGNATURE_FILE,
  refuseNativeAddon,
} from './package-paths.js';
import { compareFiles, verifySignedManifest } from './package-verify.js';
import type { PackageHost, ReadFile, SignedManifest } from './package-verify.js';
import { readRevocations, REVOCATIONS_FILE } from './revocations.js';
import type { RevocationList } from './revocations.js';
import type { SignerPurpose } from './signer.js';
import { readTar } from './tar.js';
import type { TarEntry, TarSink } from './tar.js';

/** The license terms a package carries for the operator to read before installing it. */
export const TERMS_FILE = 'files/LICENSE.md';
const TERMS_SHOWN = 64 * 1024;

/** A verified package archive. Nothing of it ran and nothing was written. */
export interface InspectedPackage extends SignedManifest {
  /** SHA-256 of the archive file: the package hash of the plan, the journal and backups. */
  readonly sha256: string;
  readonly size: number;
  readonly manifestBytes: Buffer;
  readonly signature: Buffer;
  /** The revocation list the package ships, verified; null when it ships none. */
  readonly revocations: RevocationList | null;
  /** The first 64 KiB of `files/LICENSE.md`, or null when the package has no terms. */
  readonly terms: { readonly text: string; readonly truncated: boolean } | null;
}

const META: Readonly<Record<string, number>> = {
  [MANIFEST_FILE]: PACKAGE_LIMITS.manifestBytes,
  [SIGNATURE_FILE]: PACKAGE_LIMITS.signatureBytes,
  [REVOCATIONS_FILE]: PACKAGE_LIMITS.revocationsBytes,
};

const ignore: TarSink = { write: () => undefined, end: () => undefined };

/** Hashes one compressed archive while gunzip and the tar reader stream it. */
async function walkArchive(
  file: string,
  visit: (entry: TarEntry) => TarSink | Promise<TarSink>,
): Promise<{ sha256: string; size: number }> {
  const info = await lstat(file);
  if (!info.isFile()) throw new SigningError('archive_invalid');
  if (info.size > PACKAGE_LIMITS.archiveBytes) throw new SigningError('archive_too_large');
  const hash = createHash('sha256');
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
      size += chunk.length;
      if (size > PACKAGE_LIMITS.archiveBytes) done(new SigningError('archive_too_large'));
      else {
        hash.update(chunk);
        done(null, chunk);
      }
    },
  });
  // pipeline reports a failure of its last stage as an abort of the earlier ones; the reader's
  // own refusal is kept to report its code.
  let refusal: unknown = null;
  const gunzip = createGunzip();
  try {
    await pipeline(
      createReadStream(file, { highWaterMark: 64 * 1024 }),
      tap,
      gunzip,
      async (source: AsyncIterable<unknown>) => {
        try {
          await readTar(source, visit, {
            totalBytes: PACKAGE_LIMITS.totalBytes,
            entries: PACKAGE_LIMITS.entries,
          });
        } catch (error) {
          refusal = error;
          throw error;
        }
      },
    );
  } catch (error) {
    // A refusal of the reader names the entry; any other failure of the reader is an abort
    // caused by the stage that failed first, which pipeline reports.
    throw archiveFailure(refusal instanceof SigningError ? refusal : error);
  }
  // zlib ends quietly at a zero byte after a gzip member and drops the rest: the archive hash
  // would then cover bytes no check read. Every byte of the file must belong to the stream.
  if (gunzip.bytesWritten !== size) throw new SigningError('archive_invalid');
  return { sha256: hash.digest('hex'), size };
}

/**
 * What a failed pass reports: a refusal keeps its code, and a damaged gzip stream is
 * `archive_invalid` (zlib's `Z_…` codes, and `ABORT_ERR` when zlib ends its stream early on
 * bytes after a member; no pass takes an AbortSignal). Any other error, such as a full disk or a
 * denied write while unpacking, is the host's and is thrown unchanged rather than blamed on the
 * package.
 */
export function archiveFailure(cause: unknown): Error {
  if (cause instanceof SigningError) return cause;
  const code = cause instanceof Error && 'code' in cause ? String(cause.code) : '';
  if (!(cause instanceof Error) || /^Z_/.test(code) || code === 'ABORT_ERR')
    return new SigningError('archive_invalid', null, { cause });
  return cause;
}

/**
 * The checks every entry passes before its data is read, in both passes: unique names without
 * case collisions, only the three files of the package root and the `files/` tree, no native
 * addons, and the size limit of the entry's kind.
 */
function admit(entry: TarEntry, names: EntryNames, counted: { files: number }): void {
  names.add(entry.path, entry.kind);
  const limit = META[entry.path];
  if (entry.kind === 'directory') {
    if (entry.path !== FILES_DIRECTORY && !entry.path.startsWith(`${FILES_DIRECTORY}/`))
      throw new SigningError('unexpected_entry', entry.path);
    return;
  }
  if (limit !== undefined) {
    if (entry.size > limit) throw new SigningError('entry_too_large', entry.path);
    return;
  }
  if (!entry.path.startsWith(`${FILES_DIRECTORY}/`))
    throw new SigningError('unexpected_entry', entry.path);
  refuseNativeAddon(entry.path);
  if (entry.size > PACKAGE_LIMITS.fileBytes) throw new SigningError('entry_too_large', entry.path);
  if (++counted.files > PACKAGE_LIMITS.files) throw new SigningError('too_many_entries');
}

function collector(into: Map<string, Buffer>, path: string, keep: number): TarSink {
  const chunks: Buffer[] = [];
  let kept = 0;
  return {
    write(chunk) {
      if (kept >= keep) return;
      const part = chunk.subarray(0, keep - kept);
      chunks.push(Buffer.from(part));
      kept += part.length;
    },
    end() {
      into.set(path, Buffer.concat(chunks));
    },
  };
}

function hasher(into: Map<string, ReadFile>, path: string): TarSink {
  const hash = createHash('sha256');
  let size = 0;
  return {
    write(chunk) {
      hash.update(chunk);
      size += chunk.length;
    },
    end() {
      into.set(path, { size, sha256: hash.digest('hex') });
    },
  };
}

function both(a: TarSink, b: TarSink): TarSink {
  return {
    async write(chunk) {
      await a.write(chunk);
      await b.write(chunk);
    },
    async end() {
      await a.end();
      await b.end();
    },
  };
}

/**
 * Verifies a package archive without writing anything (ADR 0078, 3.3): one streaming pass reads
 * the three root files into bounded buffers and hashes every file of `files/`; then the manifest
 * signature, the manifest, the file list, the shipped revocation list and compatibility are
 * checked, in that order. Every refusal is a SigningError with a machine code.
 */
export async function inspectModulePackage(
  file: string,
  host: PackageHost,
  purpose: SignerPurpose = 'install',
): Promise<InspectedPackage> {
  const names = new EntryNames();
  const counted = { files: 0 };
  const meta = new Map<string, Buffer>();
  const found = new Map<string, ReadFile>();
  const terms = new Map<string, Buffer>();
  const archive = await walkArchive(file, (entry) => {
    admit(entry, names, counted);
    if (entry.kind === 'directory') return ignore;
    const limit = META[entry.path];
    if (limit !== undefined) return collector(meta, entry.path, limit);
    const sink = hasher(found, entry.path);
    return entry.path === TERMS_FILE ? both(sink, collector(terms, entry.path, TERMS_SHOWN)) : sink;
  });
  const manifestBytes = meta.get(MANIFEST_FILE);
  const signature = meta.get(SIGNATURE_FILE);
  if (manifestBytes === undefined) throw new SigningError('manifest_missing');
  if (signature === undefined) throw new SigningError('signature_missing');
  const signed = verifySignedManifest(manifestBytes, signature, host, purpose);
  compareFiles(signed, found, host);
  const shipped = meta.get(REVOCATIONS_FILE);
  const shown = terms.get(TERMS_FILE);
  return {
    ...signed,
    ...archive,
    manifestBytes,
    signature,
    revocations:
      shipped === undefined ? null : readRevocations(shipped.toString('utf8'), host.keys),
    terms:
      shown === undefined
        ? null
        : {
            text: shown.toString('utf8'),
            truncated: (found.get(TERMS_FILE)?.size ?? 0) > TERMS_SHOWN,
          },
  };
}

/** Writes one entry into the new directory and checks it against what inspection saw. */
function writer(path: string, expected: ReadFile, open: () => Promise<FileHandle>): TarSink {
  const hash = createHash('sha256');
  let size = 0;
  let handle: FileHandle | null = null;
  return {
    async write(chunk) {
      handle ??= await open();
      hash.update(chunk);
      size += chunk.length;
      await handle.write(chunk);
    },
    async end() {
      handle ??= await open();
      await handle.sync();
      await handle.close();
      if (size !== expected.size || hash.digest('hex') !== expected.sha256)
        throw new SigningError('package_changed', path);
    },
  };
}

function digest(bytes: Buffer): ReadFile {
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * Unpacks an inspected archive into `destination`, which must not exist: the manifest, its
 * signature and `files/`, with modes 0644 and 0755. The archive is read again and every entry,
 * and the archive hash, must match the inspection; a file replaced between the passes gives
 * `package_changed`. The destination is created here and removed again on any failure; its
 * atomic move into place is the caller's.
 */
export async function extractModulePackage(
  file: string,
  inspected: InspectedPackage,
  destination: string,
): Promise<void> {
  const expected = new Map<string, ReadFile>([
    [MANIFEST_FILE, digest(inspected.manifestBytes)],
    [SIGNATURE_FILE, digest(inspected.signature)],
    ...inspected.manifest.package.files.map((f) => [f.path, f] as const),
  ]);
  const written = new Set<string>();
  const handles: FileHandle[] = [];
  await mkdir(destination, { mode: 0o755 });
  try {
    const names = new EntryNames();
    const counted = { files: 0 };
    const archive = await walkArchive(file, async (entry) => {
      admit(entry, names, counted);
      const target = join(destination, ...entry.path.split('/'));
      if (entry.kind === 'directory') {
        await mkdir(target, { recursive: true, mode: 0o755 });
        return ignore;
      }
      if (entry.path === REVOCATIONS_FILE) return ignore;
      const want = expected.get(entry.path);
      if (want === undefined) throw new SigningError('package_changed', entry.path);
      written.add(entry.path);
      return writer(entry.path, want, async () => {
        await mkdir(dirname(target), { recursive: true, mode: 0o755 });
        const handle = await open(target, 'wx', 0o644);
        handles.push(handle);
        return handle;
      });
    });
    if (archive.sha256 !== inspected.sha256 || written.size !== expected.size)
      throw new SigningError('package_changed');
  } catch (error) {
    await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

import { open } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import { Readable, pipeline } from 'node:stream';
import { createHash } from 'node:crypto';
import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { CliError } from '../errors.js';
import { TREE_LIMITS, TreeNames, treePath } from './tree-paths.js';
import { archiveEntries, entryContent } from './zip-read.js';

/** One file of the published tree, as a source describes it. */
export interface SourceEntry {
  readonly path: string;
  readonly size: number;
  /** From the server's table of contents; null when only the archive itself is at hand. */
  readonly sha256: string | null;
  readonly crc32: number | null;
  /** From the archive; null when the table of contents does not carry it. */
  readonly mode: number | null;
}

/**
 * Where the files of a tree come from (ADR 0083, N8): `toc` — the server's table of contents,
 * each file fetched alone by a range of the archive (T2); `archive` — the whole archive,
 * downloaded and verified first (T1).
 */
export interface TreeSource {
  readonly mode: 'toc' | 'archive';
  readonly entries: readonly SourceEntry[];
  content(entry: SourceEntry, signal: AbortSignal): AsyncIterable<Uint8Array>;
  /** SHA-256 of an entry's content: known with a table of contents, computed from the archive. */
  digest(entry: SourceEntry, signal: AbortSignal): Promise<string>;
  /** Bytes of entry content fetched from the server so far. */
  readonly fetched: () => number;
  close(): Promise<void>;
}

interface TocEntry extends SourceEntry {
  readonly method: string;
  readonly dataOffset: number;
  readonly dataLength: number;
}

const number = (value: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new CliError('invalid_response', 7);
  return result;
};

/**
 * The server's table of contents of the artifact, every page, checked again by the tree rules;
 * null when there is none to use: not built yet, refused by the server, an unknown method, or a
 * server without the route (404 `route_not_found`). Trust comes from the server, which computed
 * every SHA-256 from the archive it verified at publication.
 */
export async function serverEntries(
  client: Pick<ArkvoryClient, 'artifactTree'>,
  repository: string,
  id: string,
  signal: AbortSignal,
): Promise<{ readonly entries: readonly TocEntry[]; readonly archiveSha256: string } | null> {
  const entries: TocEntry[] = [];
  const names = new TreeNames();
  let after: string | undefined;
  let archive = '';
  try {
    do {
      const page = await client.artifactTree(repository, id, after ? { after } : {}, signal);
      if (page.status !== 'ready') return null;
      if (archive !== '' && page.archiveSha256 !== archive) throw new CliError('tree_changed', 6);
      archive = page.archiveSha256;
      for (const item of page.items) {
        if (item.method !== 'stored' && item.method !== 'deflate') return null;
        const path = treePath(item.path);
        names.add(path);
        entries.push({
          path,
          size: number(item.size),
          sha256: item.sha256,
          crc32: null,
          mode: null,
          method: item.method,
          dataOffset: number(item.dataOffset),
          dataLength: number(item.dataLength),
        });
      }
      if (entries.length > TREE_LIMITS.entries) throw new CliError('too_many_entries', 5);
      after = page.next ?? undefined;
    } while (after !== undefined);
  } catch (error) {
    if (
      error instanceof ArkvoryHttpError &&
      error.status === 404 &&
      error.reason === 'route_not_found'
    )
      return null;
    throw error;
  }
  return { entries, archiveSha256: archive };
}

/** A source by ranges of the archive; one download id holds them together in the queue. */
export function tocSource(
  client: Pick<ArkvoryClient, 'downloadRangeVerified'>,
  repository: string,
  id: string,
  toc: { readonly entries: readonly TocEntry[]; readonly archiveSha256: string },
  downloadId: string,
): TreeSource {
  let fetched = 0;
  const byPath = new Map(toc.entries.map((entry) => [entry.path, entry]));
  return {
    mode: 'toc',
    entries: toc.entries,
    fetched: () => fetched,
    async *content(entry, signal) {
      const known = byPath.get(entry.path);
      if (!known) throw new CliError('invalid_response', 7);
      if (known.dataLength === 0) return;
      const range = client.downloadRangeVerified(repository, id, {
        start: known.dataOffset,
        end: known.dataOffset + known.dataLength - 1,
        sha256: toc.archiveSha256,
        downloadId,
        signal,
      });
      const counted = (async function* () {
        const reader = range.getReader();
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) return;
            fetched += result.value.length;
            yield result.value;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      })();
      // Inflating runs on the libuv thread pool; a failed range ends the stream with its error.
      const source: AsyncIterable<unknown> =
        known.method === 'deflate'
          ? pipeline(Readable.from(counted), createInflateRaw(), () => undefined)
          : counted;
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) throw new CliError('invalid_file_stream', 7);
        yield chunk;
      }
    },
    digest: (entry) => {
      if (entry.sha256 === null) throw new CliError('invalid_response', 7);
      return Promise.resolve(entry.sha256);
    },
    close: () => Promise.resolve(),
  };
}

/** A source by a downloaded archive whose SHA-256 the SDK verified as a whole. */
export async function archiveSource(file: string): Promise<TreeSource> {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const entries = (await archiveEntries(handle, size)).map((entry) => ({
      ...entry,
      sha256: null,
      crc32: entry.crc32,
      mode: entry.mode,
    }));
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const digests = new Map<string, string>();
    const content = (entry: SourceEntry, signal: AbortSignal) => {
      const known = byPath.get(entry.path);
      if (!known) throw new CliError('invalid_archive', 5);
      return entryContent(file, handle, known, signal);
    };
    return {
      mode: 'archive',
      entries,
      fetched: () => 0,
      content,
      async digest(entry, signal) {
        const kept = digests.get(entry.path);
        if (kept !== undefined) return kept;
        const hash = createHash('sha256');
        for await (const chunk of content(entry, signal)) hash.update(chunk);
        const value = hash.digest('hex');
        digests.set(entry.path, value);
        return value;
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Table of contents of an archive artifact (ADR 0083, N8, stage T2): the file entries of a
 * published ZIP with the SHA-256 the server computed from their content and the byte range of
 * their data inside the archive, so a client verifies and repairs a directory file by file.
 */

/** Why an archive has no table of contents; a machine code stored with the archive. */
export const TREE_INDEX_REASONS = [
  /** No ZIP end of central directory record: not a ZIP archive. */
  'not_archive',
  /** A ZIP whose structure, sizes or compressed data are broken. */
  'invalid_archive',
  /** A path outside the archive root, an absolute or unsafe path, a link or a special file. */
  'unsafe_entry',
  /** An encrypted entry. */
  'encrypted_entry',
  /** More entries than TREE_MAX_ENTRIES. */
  'too_many_entries',
  /** More content than TREE_MAX_TOTAL_BYTES. */
  'too_large',
  /** An entry compressed with a method other than stored or deflate. */
  'unsupported_method',
  /** An entry whose content does not match its CRC-32. */
  'crc_mismatch',
  /** Two entries with the same path, also when they differ only in case or normalization. */
  'duplicate_entry',
] as const;
export type TreeIndexReason = (typeof TREE_INDEX_REASONS)[number];

/** The limits of UPack parsing apply to every table of contents. */
export const TREE_MAX_ENTRIES = 100_000;
export const TREE_MAX_TOTAL_BYTES = 100 * 1024 ** 3;
/** The largest page of a table of contents, also the default page. */
export const TREE_PAGE_LIMIT = 1000;

/** `stored`: the data range is the file itself; `deflate`: raw deflate of the file. */
export type TreeEntryMethod = 'stored' | 'deflate';

/** One file entry of an archive; sizes and offsets are exact safe integers. */
export interface ArchiveTreeEntry {
  /** 0-based position among the file entries (directory entries are not counted). */
  readonly ordinal: number;
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** A TreeEntryMethod when built by this release; a later one may store other methods. */
  readonly method: string;
  /** Offset of the entry's data in the archive, after its local header. */
  readonly dataOffset: number;
  /** Bytes of the entry's data in the archive (its compressed size). */
  readonly dataLength: number;
}

/** What indexing a published archive found: its file entries, or why there are none. */
export type ArchiveTree =
  | { readonly status: 'ready'; readonly entries: readonly ArchiveTreeEntry[] }
  | { readonly status: 'unavailable'; readonly reason: TreeIndexReason };

/** Artifacts the worker indexes: ZIP archives by name, raw (`.zip`) or UPack (`.upack`). */
export function treeIndexable(name: string): boolean {
  return /\.(zip|upack)$/i.test(name);
}

/**
 * The key two entry paths collide under on some client: Windows compares names without case
 * and macOS without Unicode normalization, so `A.txt`, `a.txt` and `á` against `á` would
 * overwrite each other when the tree is written there. Case is folded per character through
 * its upper case when that is one character, as Windows does (`ſ` and `s`, `ı` and `i` are one
 * name there), otherwise by its lower case. `arkvoryctl` folds tree paths the same way.
 */
export function treePathKey(path: string): string {
  let folded = '';
  for (const char of path.normalize('NFC')) {
    const upper = char.toUpperCase();
    folded += [...upper].length === 1 ? upper.toLowerCase() : char.toLowerCase();
  }
  return folded.normalize('NFC');
}

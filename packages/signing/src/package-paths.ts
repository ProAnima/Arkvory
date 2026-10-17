import { SigningError } from './errors.js';

/** Entries of a package outside `files/`; nothing else may exist (ADR 0078, 3.1). */
export const MANIFEST_FILE = 'module.json';
export const SIGNATURE_FILE = 'module.json.minisig';
export const FILES_DIRECTORY = 'files';

export const MAX_PATH_LENGTH = 240;
const MAX_DEPTH = 16;
/**
 * A name segment: ASCII letters, digits and `._+@-`, not starting with a dot or a hyphen and
 * not ending with a dot. No spaces, colons, backslashes or control characters, so a name means
 * the same on Linux and Windows and never selects a stream, a drive or a device.
 */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._+@-]{0,127}$/;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;

/**
 * The relative path of an entry with `/` separators, or a SigningError `unsafe_path`: absolute
 * paths, drive letters, `.` and `..`, empty segments, Windows device names and anything outside
 * the segment alphabet are refused. The message never repeats the refused text.
 */
export function safePath(raw: string): string {
  const path = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const segments = path.split('/');
  if (
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    segments.length > MAX_DEPTH ||
    segments.some((part) => !SEGMENT.test(part) || part.endsWith('.') || DEVICE.test(part))
  )
    throw new SigningError('unsafe_path');
  return path;
}

/**
 * Remembers every entry of one package and refuses a second entry with the same name, a name
 * that differs only in letter case (one file on Windows and macOS) and a file that is also the
 * parent of another entry.
 */
export class EntryNames {
  /** Files by their name in lower case. */
  readonly #files = new Set<string>();
  readonly #exactFiles = new Set<string>();
  /** Directories, named or implied by a deeper entry: lower case to the spelling first seen. */
  readonly #directories = new Map<string, string>();
  /** Directories that had an entry of their own. */
  readonly #named = new Set<string>();

  add(path: string, kind: 'file' | 'directory'): void {
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth++)
      this.#directory(segments.slice(0, depth).join('/'), path);
    const folded = path.toLowerCase();
    if (kind === 'file') {
      if (this.#files.has(folded) || this.#directories.has(folded))
        throw new SigningError(
          this.#exactFiles.has(path) ? 'duplicate_entry' : 'case_collision',
          path,
        );
      this.#files.add(folded);
      this.#exactFiles.add(path);
      return;
    }
    if (this.#named.has(path)) throw new SigningError('duplicate_entry', path);
    this.#directory(path, path);
    this.#named.add(path);
  }

  #directory(directory: string, entry: string): void {
    const folded = directory.toLowerCase();
    const spelling = this.#directories.get(folded);
    if (this.#files.has(folded) || (spelling !== undefined && spelling !== directory))
      throw new SigningError('case_collision', entry);
    this.#directories.set(folded, directory);
  }
}

/** Native addons are refused in format 1: the package is the same on Linux and Windows. */
export function refuseNativeAddon(path: string): void {
  if (path.toLowerCase().endsWith('.node')) throw new SigningError('native_addon', path);
}

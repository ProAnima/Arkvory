import { randomUUID } from 'node:crypto';
import { open, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from 'node:path';
import { jsonFile } from './files.js';
import type { Installation } from './model.js';
import { record } from './model.js';

/** A checked vault directory: canonical path, its vault ID (null without vault.json). */
export interface VaultLocation {
  readonly path: string;
  readonly vaultId: string | null;
  readonly empty: boolean;
}
export interface VaultContext {
  readonly root: string;
  /** Host storage directory of a native installation; Compose keeps storage in a volume. */
  readonly dataDirectory: string | undefined;
  readonly mode: Installation['mode'];
  readonly platform: NodeJS.Platform;
}

/** Each path ends up in a systemd unit, a Compose file with ${} interpolation or icacls. */
export function unsafePath(path: string): boolean {
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || `"'$%\``.includes(path.charAt(index))) return true;
  }
  return false;
}
/** The backup unit runs with ProtectHome=true and PrivateTmp=true: these trees are not shared. */
const sandboxed = ['/home', '/root', '/run/user', '/tmp', '/var/tmp'];
export function hiddenBySystemdSandbox(path: string): boolean {
  return sandboxed.some((tree) => path === tree || path.startsWith(tree + '/'));
}

function syntax(path: string, platform: NodeJS.Platform): string {
  if (unsafePath(path))
    throw new Error('The vault path contains characters that service configuration cannot carry');
  if (platform === 'win32') {
    if (path.startsWith('\\\\') || path.startsWith('//'))
      throw new Error(
        'Network share paths are not supported: the LocalService account cannot sign in to SMB shares; use a local or iSCSI volume',
      );
    if (!/^[A-Za-z]:[\\/]/.test(path))
      throw new Error('Specify the vault as an absolute path with a drive letter');
    return win32.resolve(path);
  }
  if (!path.startsWith('/') || path.includes('\\'))
    throw new Error('Specify the vault as an absolute path');
  return posix.resolve(path);
}

/** Case-insensitive on Windows, like path.relative; another drive is never contained. */
function contains(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}
const overlaps = (a: string, b: string) => contains(a, b) || contains(b, a);

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return resolve(path);
    throw error;
  }
}

/** vault.json written by `vault init`; only its identity is read here. */
export async function readVaultId(directory: string): Promise<string | null> {
  let document: unknown;
  try {
    document = await jsonFile(join(directory, 'vault.json'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('vault.json is not a readable Arkvory vault document', { cause: error });
  }
  const vault = record(document);
  if (vault['format'] !== 'arkvory-vault' || typeof vault['vaultId'] !== 'string')
    throw new Error('vault.json is not an Arkvory vault document');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vault['vaultId']))
    throw new Error('vault.json has an invalid vault ID');
  return vault['vaultId'];
}

async function writable(directory: string): Promise<void> {
  const probe = join(directory, `.arkvory-configure-${randomUUID()}`);
  try {
    await (await open(probe, 'wx', 0o600)).close();
  } catch (error) {
    throw new Error('The vault directory is not writable', { cause: error });
  }
  await unlink(probe);
}

/**
 * Checks a vault directory before anything changes: absolute, an existing writable directory,
 * not a filesystem root, separate from the installation root and the storage directory after
 * resolving symlinks, junctions and 8.3 names, and reachable from the service sandbox.
 */
export async function inspectVault(path: string, context: VaultContext): Promise<VaultLocation> {
  const requested = syntax(path, context.platform);
  let actual: string;
  try {
    actual = syntax(await realpath(requested), context.platform);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error('The vault directory does not exist; create it or mount its volume first', {
        cause: error,
      });
    throw error;
  }
  if (parse(actual).root === actual)
    throw new Error('A filesystem root cannot be a vault; use a dedicated directory');
  if (!(await stat(actual)).isDirectory()) throw new Error('The vault must be a directory');
  for (const other of [context.root, context.dataDirectory])
    if (other !== undefined && overlaps(await canonical(other), actual))
      throw new Error(
        'The vault must be outside the installation root and the storage directory, and must not contain them',
      );
  if (context.mode === 'systemd' && hiddenBySystemdSandbox(actual))
    throw new Error(
      'The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp (systemd sandbox); choose another directory',
    );
  await writable(actual);
  const vaultId = await readVaultId(actual);
  return { path: actual, vaultId, empty: (await readdir(actual)).length === 0 };
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const raw of createReadStream(path)) {
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid file bytes');
    hash.update(chunk);
  }
  return hash.digest('hex');
}
/** On POSIX only this process' user may own and change an entry; Windows ACLs are set by Setup. */
function owned(stats: Stats, uid: number | undefined): boolean {
  return uid === undefined || (stats.uid === uid && (stats.mode & 0o022) === 0);
}
async function names(directory: string, ignored: ReadonlySet<string>): Promise<string[]> {
  return (await readdir(directory)).filter((name) => !ignored.has(name)).sort();
}
async function sameEntry(existing: string, reference: string, uid: number | undefined) {
  const [left, right] = await Promise.all([lstat(existing), lstat(reference)]);
  if (!owned(left, uid)) return false;
  // Links and special files never match: the reference comes from an archive without them.
  if (left.isDirectory() && right.isDirectory())
    return sameDirectory(existing, reference, new Set(), uid);
  if (!left.isFile() || !right.isFile() || left.size !== right.size) return false;
  return (await digest(existing)) === (await digest(reference));
}
async function sameDirectory(
  existing: string,
  reference: string,
  ignored: ReadonlySet<string>,
  uid: number | undefined,
): Promise<boolean> {
  const [left, right] = await Promise.all([names(existing, ignored), names(reference, ignored)]);
  if (left.length !== right.length || left.some((name, index) => name !== right[index]))
    return false;
  for (const name of left)
    if (!(await sameEntry(join(existing, name), join(reference, name), uid))) return false;
  return true;
}
/**
 * Whether `existing` holds exactly the entries of `reference` with the same bytes, apart from
 * the top-level names in `ignored`. Entries are compared one at a time, streaming.
 */
export async function sameTree(
  existing: string,
  reference: string,
  ignored: ReadonlySet<string>,
): Promise<boolean> {
  const uid = process.getuid?.();
  const top = await lstat(existing);
  if (!top.isDirectory() || !owned(top, uid)) return false;
  return sameDirectory(existing, reference, ignored, uid);
}

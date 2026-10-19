import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ModuleDataGuard } from './module-data-coordinator.js';
import { entryAt, measureTree, requireInside } from './module-data-paths.js';
import { hasCode, syncDirectory } from './fs-durability.js';

type Counts = { bytes: number; files: number; temporaryBytes: number; temporaryFiles: number };
type Tracked = { bytes: number; files: number; temporary: boolean };
const zero = (): Counts => ({ bytes: 0, files: 0, temporaryBytes: 0, temporaryFiles: 0 });

/** Protected by the module advisory lock. A durable intent precedes every filesystem mutation.
 * Completed operations atomically publish a small shared ledger; an interrupted intent forces
 * a disk scan. Every newly opened handle also reconciles, including after machine restart.
 * Directory durability follows syncDirectory/ADR 0004, including its Windows limitations.
 * No process-local cached total authorizes a write. Ordinary chunks stat only touched files.
 */
export class ModuleDataLedger {
  counts = zero();
  owners: string[] = [];
  private readonly touched = new Map<string, Tracked>();
  private first = true;
  constructor(
    private readonly root: string,
    private readonly owner: string,
  ) {}

  async rebuild(): Promise<void> {
    const data = await measureTree(join(this.root, 'data'));
    const cache = await measureTree(join(this.root, 'cache'));
    const tmp = await measureTree(join(this.root, 'tmp'));
    this.counts = {
      bytes: data.bytes + cache.bytes,
      files: data.files + cache.files,
      temporaryBytes: tmp.bytes,
      temporaryFiles: tmp.files,
    };
    this.touched.clear();
  }

  private async load(): Promise<boolean> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.root, '.accounting.json'), 'utf8'));
      if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'version') !== 1)
        return false;
      const owners: unknown = Reflect.get(raw, 'owners');
      if (
        !Array.isArray(owners) ||
        owners.length > 4096 ||
        !owners.every(
          (owner: unknown): owner is string =>
            typeof owner === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner),
        )
      )
        return false;
      const counts = zero();
      for (const field of ['bytes', 'files', 'temporaryBytes', 'temporaryFiles'] as const) {
        const value: unknown = Reflect.get(raw, field);
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return false;
        counts[field] = value;
      }
      this.counts = counts;
      this.owners = owners;
      return true;
    } catch (error) {
      if (hasCode(error, 'ENOENT') || error instanceof SyntaxError) return false;
      throw error;
    }
  }

  private async durableFile(name: string, value: string, guard: ModuleDataGuard): Promise<void> {
    guard.check();
    const handle = await open(join(this.root, name), 'w', 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    guard.check();
  }

  async begin(guard: ModuleDataGuard): Promise<void> {
    for (const name of ['.accounting.json', '.accounting.next', '.accounting.dirty'])
      await requireInside(this.root, [name]);
    guard.check();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.touched.clear();
    const interrupted = await entryAt(join(this.root, '.accounting.dirty'));
    const loaded = await this.load();
    if (!loaded) this.owners = [];
    if (this.first || interrupted || !loaded) await this.rebuild();
    // Keep first=true on failure: a failed initialization must never enable cached admission.
    await this.durableFile('.accounting.dirty', '1', guard);
    await syncDirectory(this.root);
    if (!this.owners.includes(this.owner)) this.owners.push(this.owner);
    this.first = false;
    guard.check();
  }

  async track(path: string, temporary = false): Promise<void> {
    if (this.touched.has(path)) return;
    const before = await entryAt(path);
    this.touched.set(path, {
      bytes: before?.isFile() ? before.size : 0,
      files: before?.isFile() ? 1 : 0,
      temporary,
    });
  }

  async commit(guard: ModuleDataGuard): Promise<void> {
    for (const [path, before] of this.touched) {
      const after = await entryAt(path);
      const bytes = (after?.isFile() ? after.size : 0) - before.bytes;
      const files = (after?.isFile() ? 1 : 0) - before.files;
      this.counts[before.temporary ? 'temporaryBytes' : 'bytes'] += bytes;
      this.counts[before.temporary ? 'temporaryFiles' : 'files'] += files;
    }
    if (Object.values(this.counts).some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new ModuleServiceError('unavailable', 'Invalid data accounting');
    await this.durableFile(
      '.accounting.next',
      JSON.stringify({ version: 1, owners: this.owners, ...this.counts }),
      guard,
    );
    guard.check();
    await rename(join(this.root, '.accounting.next'), join(this.root, '.accounting.json'));
    await syncDirectory(this.root);
    guard.check();
    await rm(join(this.root, '.accounting.dirty'));
    await syncDirectory(this.root);
    guard.check();
  }
}

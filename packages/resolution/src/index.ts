import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename, dirname, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What a refused resolution throws. The code is the one Node gives a module that is not
 * installed (`MODULE_NOT_FOUND` for `require`, `ERR_MODULE_NOT_FOUND` for `import`), so an
 * optional dependency a library probes for in `try { require(...) } catch {}` behaves exactly
 * as when it is absent; the message names the refused file for the operator.
 */
export class ResolutionRefusedError extends Error {
  override readonly name = 'ResolutionRefusedError';
  constructor(
    readonly code: 'MODULE_NOT_FOUND' | 'ERR_MODULE_NOT_FOUND',
    specifier: string,
    refused: string,
  ) {
    super(
      `Cannot find module '${specifier}': module resolution is confined to the release directory; ${refused} is outside it`,
    );
  }
}

/** The roots of this thread, each a comparable real path ending in the path separator. */
interface Confinement {
  readonly roots: Set<string>;
}

/**
 * Hooks are state of the thread: Node keeps one chain per thread and every hook of it sees
 * every resolution. One process can hold two copies of this package — `launcher.mjs` and
 * `manage.mjs` bundle one, the release entry they import has its own — and two hooks with
 * separate roots would each refuse what only the other allows. The copies therefore share one
 * hook and one set of roots under a registry symbol; nothing else reads or writes it.
 */
const REGISTRY = Symbol.for('proanima.arkvory.resolution-confinement');

function isConfinement(value: unknown): value is Confinement {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'roots') instanceof Set;
}

function current(): Confinement | undefined {
  const value: unknown = Reflect.get(globalThis, REGISTRY);
  if (value === undefined) return undefined;
  if (!isConfinement(value)) throw new Error('Module resolution confinement state is invalid');
  return value;
}

/** Windows compares paths without case, like NTFS; elsewhere the case is significant. */
const comparable = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

/**
 * The real path of a resolved `file:` URL. Node's resolver already returns real paths, unless
 * `--preserve-symlinks` is given; resolving again keeps a link inside a root that points
 * outside it from passing. A file that cannot be read is compared by its own path: it does
 * not load either.
 */
function realFile(url: string): string {
  const path = fileURLToPath(url);
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function permitted(roots: ReadonlySet<string>, url: string): boolean {
  if (url.startsWith('node:')) return true;
  if (!url.startsWith('file:')) return false;
  const path = comparable(realFile(url));
  for (const root of roots) if (path.startsWith(root)) return true;
  return false;
}

/**
 * Confines module resolution of this thread (ADR 0031, addendum 2026-10-18). From the call on,
 * whatever any code loads — `import`, `import()`, `require`, and `import.meta.resolve` — must
 * be a Node built-in or a file under a root given to `allowResolutionUnder`; until a root is
 * given, only built-ins. Anything else throws `ResolutionRefusedError` before the file is
 * loaded: Node looks for a bare name in `node_modules` of every parent directory up to the
 * drive root, in `~/.node_modules`, `~/.node_libraries` and `NODE_PATH`, and an optional
 * dependency a library probes for must not load from a directory other accounts can write.
 * Resolution itself only reads files. Node 24 does not pass `require.resolve` through the
 * hooks: it may name a file outside, but loading that file is refused like any other.
 *
 * Call it first: entries import a module that calls it before any other import, so it runs
 * before the code of every library. Idempotent within a thread. Worker threads are not
 * confined; the product starts only the watchdog worker, which resolves nothing.
 */
export function confineResolution(): void {
  if (current() !== undefined) return;
  const confinement: Confinement = { roots: new Set() };
  Object.defineProperty(globalThis, REGISTRY, { value: confinement });
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (permitted(confinement.roots, resolved.url)) return resolved;
      const code = context.conditions.includes('require')
        ? 'MODULE_NOT_FOUND'
        : 'ERR_MODULE_NOT_FOUND';
      const url = resolved.url;
      throw new ResolutionRefusedError(
        code,
        specifier,
        url.startsWith('file:') ? realFile(url) : url,
      );
    },
  });
}

/**
 * Lets resolution reach files under `directory`, by its real path in both forms Windows can
 * give (a short 8.3 name stays in the JavaScript form). The caller names a directory only
 * administrators can write: a release.
 */
export function allowResolutionUnder(directory: string): void {
  const confinement = current();
  if (confinement === undefined) throw new Error('Module resolution is not confined');
  if (!isAbsolute(directory)) throw new Error('A confinement root must be an absolute path');
  for (const form of new Set([realpathSync(directory), realpathSync.native(directory)])) {
    if (dirname(form) === form) throw new Error('A filesystem root cannot be a confinement root');
    confinement.roots.add(comparable(form.endsWith(sep) ? form : form + sep));
  }
}

/**
 * The release directory of an unbundled entry, `<release>/apps/<app>/dist/<file>.js`; nothing
 * for a bundle (`launcher.mjs`, `manage.mjs`, `arkvory-setup.mjs`, the client files), which
 * holds its libraries itself and may lie in any directory: a bundle resolves only built-ins
 * until its code allows a release explicitly.
 */
export function releaseDirectoryOf(moduleUrl: string): string | undefined {
  if (!moduleUrl.startsWith('file:')) return undefined;
  const dist = dirname(fileURLToPath(moduleUrl));
  const apps = dirname(dirname(dist));
  if (basename(dist) !== 'dist' || basename(apps) !== 'apps') return undefined;
  return dirname(apps);
}

/**
 * The first statement of every shipped entry, through a module of its own app imported first:
 * confines this thread and allows the release the entry belongs to, if it is not a bundle.
 */
export function confineEntry(moduleUrl: string): void {
  confineResolution();
  const release = releaseDirectoryOf(moduleUrl);
  if (release !== undefined) allowResolutionUnder(release);
}

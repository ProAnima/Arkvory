import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, parseModuleManifest } from '@proanima/arkvory-extension-api';
import type {
  ModuleDescriptor,
  ModuleHealth,
  ModuleLifecycle,
  ModuleManifest,
} from '@proanima/arkvory-extension-api';

/** Why the code of a verified package could not be used in this process. */
export type ModuleLoadProblem =
  | 'import_failed'
  | 'import_timeout'
  | 'descriptor_invalid'
  | 'descriptor_mismatch'
  | 'config_invalid'
  | 'create_failed'
  | 'instance_invalid';

export class ModuleLoadError extends Error {
  override readonly name = 'ModuleLoadError';
  constructor(
    readonly code: ModuleLoadProblem,
    options?: ErrorOptions,
  ) {
    super(`Module could not be loaded: ${code}`, options);
  }
}

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function';

const member = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

/**
 * The descriptor the entry exports as default, read as unknown: module code is trusted because
 * ProAnimaStudio signed it, not because of its types. Its manifest must be the signed one, so
 * the plan, the fingerprint and `system/modules` describe the code that actually runs.
 */
function descriptorOf(
  exported: unknown,
  signed: ModuleManifest,
): ModuleDescriptor<unknown, unknown> {
  const descriptor = member(exported, 'default');
  const parseConfig = member(descriptor, 'parseConfig');
  const describeConfig = member(descriptor, 'describeConfig');
  const create = member(descriptor, 'create');
  if (!isFunction(parseConfig) || !isFunction(describeConfig) || !isFunction(create))
    throw new ModuleLoadError('descriptor_invalid');
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleManifest(member(descriptor, 'manifest'));
  } catch (error) {
    throw new ModuleLoadError('descriptor_invalid', { cause: error });
  }
  if (canonicalJson({ ...manifest }) !== canonicalJson({ ...signed }))
    throw new ModuleLoadError('descriptor_mismatch');
  return {
    manifest: signed,
    parseConfig: (input) => parseConfig.call(descriptor, input),
    // Not called: a signed module enters the plan fingerprint with the operator's settings as
    // written, which every process can read, including those that never import the module.
    describeConfig: () => null,
    create: (context, config) => instanceOf(create.call(descriptor, context, config)),
  };
}

/** A created module checked for the lifecycle the host calls; anything else is refused. */
function instanceOf(value: unknown): ModuleLifecycle {
  const start = member(value, 'start');
  const drain = member(value, 'drain');
  const stop = member(value, 'stop');
  const health = member(value, 'health');
  if (!isFunction(start) || !isFunction(drain) || !isFunction(stop) || !isFunction(health))
    throw new ModuleLoadError('instance_invalid');
  return {
    start: (signal) => Promise.resolve(start.call(value, signal)).then(() => undefined),
    drain: (budgetMs) => Promise.resolve(drain.call(value, budgetMs)).then(() => undefined),
    stop: () => Promise.resolve(stop.call(value)).then(() => undefined),
    health: () => healthOf(health.call(value)),
  };
}

const STATUSES = ['ok', 'degraded', 'failed'] as const;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The module's own report when it keeps the contract, otherwise `failed` with `health_invalid`.
 * An exception is left to the host, which reports it as `health_unavailable`.
 */
function healthOf(report: unknown): ModuleHealth {
  // An asynchronous health() breaks the contract; its rejection must not end the process.
  if (report instanceof Promise) report.catch(() => undefined);
  const status = STATUSES.find((known) => known === member(report, 'status'));
  const code = member(report, 'code');
  if (status && (code === null || (typeof code === 'string' && CODE.test(code))))
    return { status, code };
  return { status: 'failed', code: 'health_invalid' };
}

/** What a signed module's code gets when it reaches for a file outside its verified package. */
class ModuleOutsideError extends Error {
  override readonly name = 'ModuleOutsideError';
  readonly code = 'ERR_MODULE_OUTSIDE_PACKAGE';
  constructor() {
    super('A signed module may import only its own files and Node built-ins');
  }
}

/** `file:` URLs of the verified package directories, each ending in `/`; Windows: lower case. */
const verifiedPackages = new Set<string>();
/** The entry URLs the loader imports, with the package each must stay in. */
const verifiedEntries = new Map<string, string>();
let confined = false;

const comparable = (url: string) => (process.platform === 'win32' ? url.toLowerCase() : url);

function packageOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const key = comparable(url);
  for (const root of verifiedPackages) if (key.startsWith(root)) return root;
  return undefined;
}

/**
 * Keeps the code of signed modules inside the packages that were verified (ADR 0078, 3.3). Node
 * looks for a bare name in `node_modules` of every parent directory up to the drive root, in the
 * home directory of the service account and in NODE_PATH; on Windows any local user may create
 * `C:\node_modules` and `C:\ProgramData\node_modules`, and the service profile is writable by
 * every LocalService service. Without this hook an optional dependency a bundle probes for would
 * load from there into the service. Whatever a module file resolves — `import`, `import()`,
 * `import.meta.resolve`, `require` — must be a Node built-in or a file of the same package;
 * anything else throws `ERR_MODULE_OUTSIDE_PACKAGE` before it is loaded. Resolution itself
 * only reads files; the code a resolution names is never evaluated when it is refused. The hook
 * runs in this thread only: a Worker a module starts is its own code's choice (ADR 0078, 7).
 */
function confine(): void {
  if (confined) return;
  confined = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const root = packageOf(context.parentURL) ?? verifiedEntries.get(specifier);
      if (
        root !== undefined &&
        !resolved.url.startsWith('node:') &&
        !comparable(resolved.url).startsWith(root)
      )
        throw new ModuleOutsideError();
      return resolved;
    },
  });
}

/** How long one entry may take to import, its top-level code included (ADR 0079, X4). */
export const SIGNED_IMPORT_BUDGET_MS = 30_000;

/**
 * The import, or `import_timeout` after `budgetMs`: top-level code that awaits forever must not
 * hold the start of the process. Node cannot cancel an import; its late result is ignored.
 */
async function bounded<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ModuleLoadError('import_timeout'));
    }, budgetMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The only place of the core that imports code by a computed specifier (ADR 0078, 3.3; listed in
 * COMPUTED_IMPORTS of the policy). The caller passes a package directory that passed the access
 * check and `verifyInstalledModule` in this process start, and an entry path of its signed
 * manifest; the import uses a `file:` URL inside that directory, and the code it loads may
 * resolve only files of that directory (`confine`). Node caches a module by its URL, so a second
 * server in the same process reuses the code it verified the first time.
 */
export async function importVerifiedEntry(
  directory: string,
  entry: string,
  signed: ModuleManifest,
  budgetMs = SIGNED_IMPORT_BUDGET_MS,
): Promise<ModuleDescriptor<unknown, unknown>> {
  const url = pathToFileURL(join(directory, ...entry.split('/'))).href;
  // Node resolves a file URL to its real path, so the package is known by its real path too.
  const root = comparable(`${pathToFileURL(realpathSync(directory)).href}/`);
  verifiedPackages.add(root);
  verifiedEntries.set(url, root);
  confine();
  let exported: unknown;
  try {
    exported = await bounded(import(url), budgetMs);
  } catch (error) {
    if (error instanceof ModuleLoadError) throw error;
    throw new ModuleLoadError('import_failed', { cause: error });
  }
  return descriptorOf(exported, signed);
}

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

/**
 * The only place of the core that imports code by a computed specifier (ADR 0078, 3.3; listed in
 * COMPUTED_IMPORTS of the policy). The caller passes a package directory that passed the access
 * check and `verifyInstalledModule` in this process start, and an entry path of its signed
 * manifest; the import uses a `file:` URL inside that directory. Node caches a module by its URL,
 * so a second server in the same process reuses the code it verified the first time.
 */
export async function importVerifiedEntry(
  directory: string,
  entry: string,
  signed: ModuleManifest,
): Promise<ModuleDescriptor<unknown, unknown>> {
  const url = pathToFileURL(join(directory, ...entry.split('/'))).href;
  let exported: unknown;
  try {
    exported = await import(url);
  } catch (error) {
    throw new ModuleLoadError('import_failed', { cause: error });
  }
  return descriptorOf(exported, signed);
}

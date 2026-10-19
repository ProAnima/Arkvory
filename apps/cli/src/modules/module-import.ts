import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '@proanima/arkvory-extension-api';
import type {
  ModuleJson,
  ModuleManifest,
  TransferExtension,
} from '@proanima/arkvory-extension-api';
import { parseModuleFields } from '@proanima/arkvory-signing';
import { confinePackage } from '@proanima/arkvory-resolution';

/** Why the code of a verified client package was not used. */
export type ClientLoadProblem =
  | 'import_failed'
  | 'import_timeout'
  | 'descriptor_invalid'
  | 'descriptor_mismatch'
  | 'create_failed'
  | 'contribution_invalid';

export class ClientLoadError extends Error {
  override readonly name = 'ClientLoadError';
  constructor(
    readonly code: ClientLoadProblem,
    options?: ErrorOptions,
  ) {
    super(`Client module could not be loaded: ${code}`, options);
  }
}

/** How long the import of one entry, its top-level code included, may take. */
export const CLIENT_IMPORT_BUDGET_MS = 10_000;

const member = (value: unknown, key: PropertyKey): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

async function bounded<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ClientLoadError('import_timeout'));
    }, budgetMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function asyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof member(value, Symbol.asyncIterator) === 'function';
}

/** Bytes only: a module that yields anything else fails the transfer it carries. */
async function* bytesOf(source: AsyncIterable<unknown>): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw new ClientLoadError('contribution_invalid');
    yield chunk;
  }
}

/**
 * A transfer extension as the SDK needs it, read as unknown: module code is trusted because
 * ProAnimaStudio signed it, not because of its types. Its methods are called on the module's
 * own object; what they return is checked here and again by the SDK.
 */
function transferExtension(value: unknown): TransferExtension {
  const name = member(value, 'name');
  const versions = member(value, 'versions');
  const download = member(value, 'download');
  const upload = member(value, 'upload');
  if (
    typeof name !== 'string' ||
    !/^[a-z][a-z0-9-]{1,31}$/.test(name) ||
    !Array.isArray(versions) ||
    versions.length === 0 ||
    versions.length > 32 ||
    (download !== undefined && typeof download !== 'function') ||
    (upload !== undefined && typeof upload !== 'function') ||
    (download === undefined && upload === undefined)
  )
    throw new ClientLoadError('contribution_invalid');
  const known = versions.filter(
    (v: unknown): v is string =>
      typeof v === 'string' && /^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}(-[0-9A-Za-z.-]+)?$/.test(v),
  );
  if (known.length !== versions.length) throw new ClientLoadError('contribution_invalid');
  return {
    name,
    versions: known,
    ...(typeof download === 'function'
      ? {
          download: async (plan, signal) => {
            const result: unknown = await Reflect.apply(download, value, [plan, signal]);
            if (result === null) return null;
            if (!asyncIterable(result)) throw new ClientLoadError('contribution_invalid');
            return bytesOf(result);
          },
        }
      : {}),
    ...(typeof upload === 'function'
      ? {
          upload: async (plan, signal) => {
            const result: unknown = await Reflect.apply(upload, value, [plan, signal]);
            return result === true;
          },
        }
      : {}),
  };
}

/**
 * The only place of `arkvoryctl` that imports code by a computed specifier (listed in
 * COMPUTED_IMPORTS of the policy). The caller passes a package directory that passed the access
 * check and `verifyInstalledModule` in this run, and an entry of its signed manifest. Before the
 * import the package is confined to its own directory (`confinePackage`), so its code resolves
 * nothing else; the entry's manifest must equal the signed one, and `create` gets only the
 * client context. Returns the transfer extensions the module contributes.
 */
export async function importClientModule(
  directory: string,
  entry: string,
  signed: ModuleManifest,
  context: { readonly signal: AbortSignal; readonly clientVersion: string },
  budgetMs = CLIENT_IMPORT_BUDGET_MS,
): Promise<readonly TransferExtension[]> {
  confinePackage(directory);
  let exported: unknown;
  try {
    exported = await bounded(
      import(pathToFileURL(join(directory, ...entry.split('/'))).href),
      budgetMs,
    );
  } catch (error) {
    if (error instanceof ClientLoadError) throw error;
    throw new ClientLoadError('import_failed', { cause: error });
  }
  const descriptor = member(exported, 'default');
  const create = member(descriptor, 'create');
  if (typeof create !== 'function') throw new ClientLoadError('descriptor_invalid');
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleFields(member(descriptor, 'manifest'), 'client');
  } catch (error) {
    throw new ClientLoadError('descriptor_invalid', { cause: error });
  }
  if (canonicalJson(manifestJson(manifest)) !== canonicalJson(manifestJson(signed)))
    throw new ClientLoadError('descriptor_mismatch');
  let module: unknown;
  try {
    module = create.call(descriptor, context);
  } catch (error) {
    throw new ClientLoadError('create_failed', { cause: error });
  }
  const transfer = member(module, 'transfer');
  if (transfer === undefined) return [];
  if (!Array.isArray(transfer) || transfer.length > 16)
    throw new ClientLoadError('contribution_invalid');
  return transfer.map((item: unknown) => transferExtension(item));
}

/** A manifest as plain JSON, for comparing two of them field by field. */
function manifestJson(manifest: ModuleManifest): ModuleJson {
  const { resources, ...rest } = manifest;
  return { ...rest, resources: resources ? { ...resources } : null };
}

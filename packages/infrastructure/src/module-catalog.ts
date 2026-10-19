import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  AccessScope,
  ArtifactView,
  ByteRange,
  CatalogRead,
  ContentHandle,
  ContentRead,
  PageRequest,
  SearchHit,
  SearchQuery,
} from '@proanima/arkvory-extension-api';
import type { Principal } from '@proanima/arkvory-domain';
import type { ScopedArtifact, ScopedCatalog, ScopedContent } from '@proanima/arkvory-application';
import { serviceCall } from './module-errors.js';

/** A copy of a principal nobody can change: a module never reaches the caller's object. */
function sealed<T>(value: T): T {
  if (typeof value === 'object' && value !== null)
    for (const field of Object.values(value)) sealed(field);
  return Object.freeze(value);
}

/**
 * The access scopes of one module in one host (ADR 0083, N4). A scope is an empty frozen object
 * the core remembers with a frozen copy of its principals; a module can pass it around but not
 * read, build or widen it, and an object these scopes did not make has no principals, so it
 * sees nothing. The host keeps one `AccessScopes` per module: a scope handed to another module
 * (through a capability value, say) reads nothing there.
 */
export class AccessScopes {
  constructor(private readonly lifetime: AbortSignal = new AbortController().signal) {}
  private readonly entries = new WeakMap<
    object,
    {
      principals: readonly Principal[];
      controller: AbortController;
      signal: AbortSignal;
    }
  >();

  of(principals: readonly Principal[], parents: readonly AbortSignal[] = []): AccessScope {
    const token: object = Object.freeze({});
    const controller = new AbortController();
    this.entries.set(token, {
      principals: sealed(principals.map((principal) => structuredClone(principal))),
      controller,
      signal: AbortSignal.any([this.lifetime, controller.signal, ...parents]),
    });
    // Only the host creates branded scopes; modules see an opaque frozen token.
    return token as AccessScope;
  }

  principalsOf(scope: AccessScope): readonly Principal[] {
    const entry = this.entries.get(scope);
    return entry && !entry.signal.aborted ? entry.principals : [];
  }

  signal(scope: AccessScope): AbortSignal {
    return this.entries.get(scope)?.signal ?? AbortSignal.abort();
  }

  revoke(scope: AccessScope): void {
    this.entries.get(scope)?.controller.abort();
  }

  intersect(first: AccessScope, second: AccessScope): AccessScope {
    const a = this.principalsOf(first),
      b = this.principalsOf(second);
    return this.of(a.length && b.length ? [...a, ...b] : [], [
      this.signal(first),
      this.signal(second),
    ]);
  }
}

function view({ upload, metadata }: ScopedArtifact): ArtifactView {
  const { name, size, sha256, labels } = upload.descriptor;
  return {
    repository: upload.repository,
    id: upload.id,
    name,
    size,
    sha256,
    labels: [...labels],
    metadata: metadata ? { ...upload.descriptor.metadata } : null,
    createdAt: upload.createdAt,
  };
}

function pageLimit(limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ModuleServiceError('invalid_input', 'Invalid page limit');
  return String(limit);
}

/**
 * The bytes of an opened blob: `read()` without a range reads the range `open` was given (the
 * whole blob without one), and every range is checked against the size before any byte is
 * asked of the storage, so a storage only ever sees exact ranges inside its object.
 */
function handle(
  content: ScopedContent,
  opened: ByteRange | undefined,
  signal: AbortSignal,
): ContentHandle {
  let released = false;
  let releasing: Promise<void> | undefined;
  const readers = new Set<() => Promise<IteratorResult<Uint8Array>>>();
  const { size, sha256 } = content.upload.descriptor;
  const check = () => {
    if (released || signal.aborted)
      throw new ModuleServiceError('unavailable', 'Content handle released');
    content.pin.check();
  };
  const release = () => {
    released = true;
    signal.removeEventListener('abort', onAbort);
    // Revoke synchronously, but retain both object and global unlink protection until every
    // backend next/return has settled. allSettled also waits for siblings if cleanup fails.
    return (releasing ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...readers].map((close) => close()));
      await content.pin.release();
      if (results.some((result) => result.status === 'rejected'))
        throw new ModuleServiceError('unavailable', 'Content cleanup failed');
    }));
  };
  const onAbort = () => {
    void release().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    descriptor: { size, sha256 },
    read(given?: ByteRange) {
      const source = contentChunks(content, given ?? opened, check);
      let closing: Promise<IteratorResult<Uint8Array>> | undefined;
      const close = () =>
        (closing ??= source.return(undefined).finally(() => readers.delete(close)));
      // Track the inner generator, not the consumer: return() closes an abandoned yield and
      // queues behind an in-flight next(), including its backend finally/late operation.
      if (!released) readers.add(close);
      const stream: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          try {
            check();
            const item = await source.next();
            check();
            if (item.done) readers.delete(close);
            return item;
          } catch (error) {
            await close().catch(() => {
              throw new ModuleServiceError('unavailable', 'Content cleanup failed');
            });
            if (error instanceof ModuleServiceError) throw error;
            throw new ModuleServiceError('unavailable', 'Content read failed');
          }
        },
        return: close,
      };
      return stream;
    },
    release,
  };
}

async function* contentChunks(
  content: ScopedContent,
  range: ByteRange | undefined,
  check: () => void,
): AsyncGenerator<Uint8Array, void, unknown> {
  check();
  if (range !== undefined && !inside(range, content.upload.descriptor.size))
    throw new ModuleServiceError('invalid_input', 'Range outside the content');
  for await (const chunk of content.read(range)) {
    check();
    yield chunk;
    check();
  }
}

/**
 * A range as a module may pass it: an object with ordered non-negative safe integers. It is
 * checked before any rights, like every malformed input; `inside` checks it against a size.
 */
function rangeOf(range: unknown): ByteRange | undefined {
  if (range === undefined) return undefined;
  if (typeof range === 'object' && range !== null) {
    const start: unknown = Reflect.get(range, 'start');
    const end: unknown = Reflect.get(range, 'end');
    if (
      typeof start === 'number' &&
      typeof end === 'number' &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      start <= end
    )
      return { start, end };
  }
  throw new ModuleServiceError('invalid_input', 'Invalid range');
}

function inside(range: ByteRange, size: number): boolean {
  const checked = rangeOf(range);
  return checked !== undefined && checked.end < size;
}

/**
 * `catalog-read` and `content-read` for the modules of one process (ADR 0083, N4): the core's
 * use cases with the principals of the scope, their results as the contract's views, their
 * failures as the contract's codes.
 */
export function moduleCatalog(
  scoped: ScopedCatalog,
  scopes: AccessScopes,
): { readonly catalog: CatalogRead; readonly content: ContentRead } {
  const of = (scope: AccessScope) => scopes.principalsOf(scope);
  const scopeCall = <T>(scope: AccessScope, work: () => Promise<T>) =>
    serviceCall(async () => {
      const active = !scopes.signal(scope).aborted;
      const value = await work();
      if (active && scopes.signal(scope).aborted)
        throw new ModuleServiceError('unavailable', 'Scope revoked');
      return value;
    });
  const catalog: CatalogRead = {
    artifact: (scope, repository, id) =>
      scopeCall(scope, async () => {
        const found = await scoped.artifact(of(scope), repository, id);
        return found ? view(found) : null;
      }),
    artifacts: (scope, repository, page: PageRequest) =>
      scopeCall(scope, async () => {
        const found = await scoped.artifacts(of(scope), repository, page.after, page.limit);
        return { items: found.items.map(view), next: found.next };
      }),
    batch: (scope, repository, ids) =>
      scopeCall(scope, async () => {
        const found = await scoped.batch(of(scope), repository, ids);
        return { found: found.found.map(view), missing: found.missing };
      }),
    resolvePackage: (scope, repository, query) =>
      scopeCall(scope, async () => {
        const found = await scoped.resolvePackage(of(scope), repository, query);
        return found ? { group: query.group, name: query.name, artifact: view(found) } : null;
      }),
    asset: (scope, repository, path) =>
      scopeCall(scope, async () => {
        const entry = await scoped.asset(of(scope), repository, path);
        return entry
          ? { path: entry.path, revision: entry.revision, artifactId: entry.artifactId }
          : null;
      }),
    search: (scope, query: SearchQuery) =>
      scopeCall(scope, async () => {
        const found = await scoped.search(of(scope), {
          q: query.text,
          repositories: query.repositories.join(','),
          labels: query.labels.join(','),
          ...(query.stage === null ? {} : { stage: query.stage }),
          ...(query.after === null ? {} : { after: query.after }),
          limit: pageLimit(query.limit),
        });
        const items: SearchHit[] = found.items.map((item) => ({
          repository: item.repository,
          id: item.id,
          name: item.name,
          size: Number(item.size),
          labels: [...item.labels],
          stages: [...item.stages],
          createdAt: item.createdAt,
          publishedAt: item.publishedAt,
        }));
        return { items, next: found.next };
      }),
    intersect: (first, second) => scopes.intersect(first, second),
  };
  const content: ContentRead = {
    open: (scope, ref, range) =>
      serviceCall(async () => {
        const requested = rangeOf(range);
        const opened = await scoped.content(of(scope), ref.repository, ref.id);
        if (opened === null) return null;
        // The pin is held from here: nothing may throw before the handle owns it.
        if (requested !== undefined && requested.end >= opened.upload.descriptor.size) {
          await opened.pin.release();
          throw new ModuleServiceError('invalid_input', 'Range outside the content');
        }
        if (scopes.signal(scope).aborted) {
          await opened.pin.release();
          return null;
        }
        return handle(opened, requested, scopes.signal(scope));
      }),
  };
  return { catalog, content };
}

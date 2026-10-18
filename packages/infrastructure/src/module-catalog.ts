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
  private readonly principals = new WeakMap<object, readonly Principal[]>();

  /** The scope of a request's or a module's principal, or of all of them at once. */
  of(principals: readonly Principal[]): AccessScope {
    const token: object = Object.freeze({});
    this.principals.set(token, sealed(principals.map((principal) => structuredClone(principal))));
    // The brand exists only in types: this module is the one place that makes scopes.
    return token as AccessScope;
  }

  principalsOf(scope: AccessScope): readonly Principal[] {
    return this.principals.get(scope) ?? [];
  }

  intersect(first: AccessScope, second: AccessScope): AccessScope {
    const both = [...this.principalsOf(first), ...this.principalsOf(second)];
    // A side without principals has no rights: the intersection has none either.
    if (this.principalsOf(first).length === 0 || this.principalsOf(second).length === 0)
      return this.of([]);
    return this.of(both);
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
function handle(content: ScopedContent, opened: ByteRange | undefined): ContentHandle {
  let released = false;
  const { size, sha256 } = content.upload.descriptor;
  return {
    descriptor: { size, sha256 },
    async *read(given?: ByteRange) {
      if (released) throw new ModuleServiceError('unavailable', 'Content handle released');
      const range = given ?? opened;
      if (range !== undefined && !inside(range, size))
        throw new ModuleServiceError('invalid_input', 'Range outside the content');
      try {
        content.pin.check();
        for await (const chunk of content.read(range)) {
          // The protection is checked between chunks: a lost pin ends the read.
          content.pin.check();
          yield chunk;
        }
      } catch (error) {
        if (error instanceof ModuleServiceError) throw error;
        throw new ModuleServiceError('unavailable', 'Content read failed');
      }
    },
    async release() {
      if (released) return;
      released = true;
      await content.pin.release();
    },
  };
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
  const catalog: CatalogRead = {
    artifact: (scope, repository, id) =>
      serviceCall(async () => {
        const found = await scoped.artifact(of(scope), repository, id);
        return found ? view(found) : null;
      }),
    artifacts: (scope, repository, page: PageRequest) =>
      serviceCall(async () => {
        const found = await scoped.artifacts(of(scope), repository, page.after, page.limit);
        return { items: found.items.map(view), next: found.next };
      }),
    batch: (scope, repository, ids) =>
      serviceCall(async () => {
        const found = await scoped.batch(of(scope), repository, ids);
        return { found: found.found.map(view), missing: found.missing };
      }),
    resolvePackage: (scope, repository, query) =>
      serviceCall(async () => {
        const found = await scoped.resolvePackage(of(scope), repository, query);
        return found ? { group: query.group, name: query.name, artifact: view(found) } : null;
      }),
    asset: (scope, repository, path) =>
      serviceCall(async () => {
        const entry = await scoped.asset(of(scope), repository, path);
        return entry
          ? { path: entry.path, revision: entry.revision, artifactId: entry.artifactId }
          : null;
      }),
    search: (scope, query: SearchQuery) =>
      serviceCall(async () => {
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
        return handle(opened, requested);
      }),
  };
  return { catalog, content };
}

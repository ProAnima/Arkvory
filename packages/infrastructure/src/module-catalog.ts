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

/**
 * The access scopes of one host (ADR 0083, N4). A scope is an empty frozen object the core
 * remembers with its principals; a module can pass it around but not read, build or widen it,
 * and an object the core did not make has no principals, so it sees nothing.
 */
export class AccessScopes {
  private readonly principals = new WeakMap<object, readonly Principal[]>();

  /** The scope of a request's or a module's principal, or of all of them at once. */
  of(principals: readonly Principal[]): AccessScope {
    const token: object = Object.freeze({});
    this.principals.set(token, Object.freeze([...principals]));
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

function handle(content: ScopedContent): ContentHandle {
  let released = false;
  const { size, sha256 } = content.upload.descriptor;
  return {
    descriptor: { size, sha256 },
    async *read(range?: ByteRange) {
      if (released) throw new ModuleServiceError('unavailable', 'Content handle released');
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

function validRange(range: ByteRange | undefined, size: number): boolean {
  return (
    range === undefined ||
    (Number.isSafeInteger(range.start) &&
      Number.isSafeInteger(range.end) &&
      range.start >= 0 &&
      range.start <= range.end &&
      range.end < size)
  );
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
        const opened = await scoped.content(of(scope), ref.repository, ref.id);
        if (opened === null) return null;
        if (!validRange(range, opened.upload.descriptor.size)) {
          await opened.pin.release();
          throw new ModuleServiceError('invalid_input', 'Range outside the content');
        }
        return handle(opened);
      }),
  };
  return { catalog, content };
}

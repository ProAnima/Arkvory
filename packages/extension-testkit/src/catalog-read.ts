import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { AccessScope, CatalogRead, ContentRead } from '@proanima/arkvory-extension-api';
import { gather, hasCode, sha256 } from './support.js';

/**
 * A catalog under test: one repository with a published and a pending upload, a repository the
 * reader has no right in, and scopes with different rights.
 */
export interface CatalogReadHarness {
  readonly catalog: CatalogRead;
  readonly content: ContentRead;
  readonly repository: string;
  /** May list and read artifacts, annotations and content of `repository`. */
  readonly reader: AccessScope;
  /** May list and read artifacts of `repository`, but neither annotations nor content. */
  readonly lister: AccessScope;
  /** Has no right in `repository`. */
  readonly stranger: AccessScope;
  /** A published artifact of `repository` with descriptor metadata, and its bytes. */
  readonly published: { readonly id: string; readonly bytes: Uint8Array };
  /** An upload of `repository` that is not published. */
  readonly pending: string;
  /** A well-formed id that names nothing. */
  readonly absent: string;
  /** A repository with a published artifact the reader may not see. */
  readonly foreign: { readonly repository: string; readonly id: string };
  /** A package of `repository` whose latest version is `published`. */
  readonly packageName: { readonly group: string; readonly name: string };
  /** An asset path of `repository` pointing at `published`. */
  readonly assetPath: string;
}

async function uniformNull(open: () => Promise<CatalogReadHarness>): Promise<void> {
  const h = await open();
  assert.equal(
    (await h.catalog.artifact(h.reader, h.repository, h.published.id))?.id,
    h.published.id,
  );
  for (const [scope, repository, id] of [
    [h.reader, h.repository, h.absent],
    [h.reader, h.repository, h.pending],
    [h.stranger, h.repository, h.published.id],
    [h.reader, h.foreign.repository, h.foreign.id],
    [h.reader, 'no-such-repository', h.published.id],
  ] as const)
    assert.equal(await h.catalog.artifact(scope, repository, id), null);
  const batch = await h.catalog.batch(h.reader, h.repository, [
    h.published.id,
    h.absent,
    h.pending,
  ]);
  assert.deepEqual(
    batch.found.map((view) => view.id),
    [h.published.id],
  );
  assert.deepEqual([...batch.missing].sort(), [h.absent, h.pending].sort());
  const denied = await h.catalog.batch(h.stranger, h.repository, [h.published.id, h.absent]);
  assert.deepEqual(denied.found, []);
  assert.deepEqual([...denied.missing].sort(), [h.published.id, h.absent].sort());
  const page = await h.catalog.artifacts(h.stranger, h.repository, { after: null, limit: 10 });
  assert.deepEqual(page, { items: [], next: null });
}

async function narrowedScopes(open: () => Promise<CatalogReadHarness>): Promise<void> {
  const h = await open();
  const narrowed = h.catalog.intersect(h.reader, h.stranger);
  assert.equal(await h.catalog.artifact(narrowed, h.repository, h.published.id), null);
  const same = h.catalog.intersect(h.reader, h.reader);
  assert.notEqual(await h.catalog.artifact(same, h.repository, h.published.id), null);
  // Metadata needs annotation.read; the lister sees the artifact without it.
  const listed = await h.catalog.artifact(h.lister, h.repository, h.published.id);
  assert.equal(listed?.metadata, null);
  const read = await h.catalog.artifact(h.reader, h.repository, h.published.id);
  assert.notEqual(read?.metadata, null);
  // Deliberately forged: a module can type any object as a scope, the core must refuse it.
  const forged = Object.freeze({}) as unknown as AccessScope;
  assert.equal(await h.catalog.artifact(forged, h.repository, h.published.id), null);
  assert.equal(
    await h.content.open(forged, { repository: h.repository, id: h.published.id }),
    null,
  );
}

async function catalogQueries(open: () => Promise<CatalogReadHarness>): Promise<void> {
  const h = await open();
  const query = { ...h.packageName, version: null };
  const found = await h.catalog.resolvePackage(h.reader, h.repository, query);
  assert.equal(found?.artifact.id, h.published.id);
  assert.equal(await h.catalog.resolvePackage(h.stranger, h.repository, query), null);
  const missing = { ...query, name: `${query.name}-none` };
  assert.equal(await h.catalog.resolvePackage(h.reader, h.repository, missing), null);
  assert.equal(
    (await h.catalog.asset(h.reader, h.repository, h.assetPath))?.artifactId,
    h.published.id,
  );
  assert.equal(await h.catalog.asset(h.stranger, h.repository, h.assetPath), null);
  assert.equal(await h.catalog.asset(h.reader, h.repository, `${h.assetPath}.none`), null);
  const search = { text: '', repositories: [], labels: [], stage: null, after: null, limit: 100 };
  const hits = await h.catalog.search(h.reader, search);
  assert.ok(hits.items.some((hit) => hit.id === h.published.id));
  assert.ok(hits.items.every((hit) => hit.id !== h.foreign.id && hit.id !== h.pending));
  const stranger = await h.catalog.search(h.stranger, {
    ...search,
    repositories: [h.repository],
  });
  assert.ok(stranger.items.every((hit) => hit.repository !== h.repository));
}

async function boundedPages(open: () => Promise<CatalogReadHarness>): Promise<void> {
  const h = await open();
  const page = await h.catalog.artifacts(h.reader, h.repository, { after: null, limit: 100 });
  assert.ok(page.items.some((view) => view.id === h.published.id));
  await assert.rejects(
    h.catalog.artifacts(h.reader, h.repository, { after: null, limit: 101 }),
    (error) => hasCode(error, 'invalid_input'),
  );
  await assert.rejects(
    h.catalog.batch(
      h.reader,
      h.repository,
      Array.from({ length: 101 }, () => h.absent),
    ),
    (error) => hasCode(error, 'invalid_input'),
  );
  const search = { text: '', repositories: [], labels: [], stage: null, after: null };
  await assert.rejects(h.catalog.search(h.reader, { ...search, limit: 101 }), (error) =>
    hasCode(error, 'invalid_input'),
  );
}

async function pinnedContent(open: () => Promise<CatalogReadHarness>): Promise<void> {
  const h = await open();
  const ref = { repository: h.repository, id: h.published.id };
  for (const [scope, target] of [
    [h.stranger, ref],
    [h.lister, ref],
    [h.reader, { ...ref, id: h.absent }],
    [h.reader, { ...ref, id: h.pending }],
    [h.reader, h.foreign],
  ] as const)
    assert.equal(await h.content.open(scope, target), null);
  const handle = await h.content.open(h.reader, ref);
  assert.ok(handle);
  assert.equal(handle.descriptor.size, h.published.bytes.byteLength);
  assert.equal(handle.descriptor.sha256, sha256(h.published.bytes));
  assert.deepEqual(await gather(handle.read()), h.published.bytes);
  assert.deepEqual(
    await gather(handle.read({ start: 1, end: 3 })),
    h.published.bytes.subarray(1, 4),
  );
  await handle.release();
  await handle.release();
  await assert.rejects(gather(handle.read()), (error) => hasCode(error, 'unavailable'));
  const size = h.published.bytes.byteLength;
  await assert.rejects(h.content.open(h.reader, ref, { start: 0, end: size }), (error) =>
    hasCode(error, 'invalid_input'),
  );
}

const CASES: readonly (readonly [
  string,
  (open: () => Promise<CatalogReadHarness>) => Promise<void>,
])[] = [
  ['absent, unpublished, forbidden and foreign are one null', uniformNull],
  ['an intersection narrows rights; a scope the core did not make has none', narrowedScopes],
  ['packages, assets and search answer within the same rights', catalogQueries],
  ['pages and batches are bounded', boundedPages],
  ['content is pinned for the reader only and released exactly once', pinnedContent],
];

/**
 * The `catalog-read` and `content-read` contract (ADR 0083, N4): no existence oracle, rights
 * narrowed by intersection, bounded pages, pinned content released exactly once.
 */
export function catalogReadContract(
  name: string,
  open: (t: TestContext) => Promise<CatalogReadHarness>,
): void {
  for (const [title, run] of CASES) void test(`${name}: ${title}`, (t) => run(() => open(t)));
}

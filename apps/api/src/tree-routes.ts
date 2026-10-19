import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, TREE_PAGE_LIMIT } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ArtifactTrees, ArtifactTreeView } from '@proanima/arkvory-application';
import { artifactTreeSchema, type ArtifactTree } from '@proanima/arkvory-contracts';

/** Sizes and offsets are decimal strings on the wire: archives may pass 2^53 one day. */
export function wireTree(view: ArtifactTreeView): ArtifactTree {
  return {
    status: view.status,
    reason: view.reason,
    archiveSha256: view.archiveSha256,
    entries: view.entries,
    items: view.items.map((entry) => ({
      ordinal: entry.ordinal,
      path: entry.path,
      size: String(entry.size),
      sha256: entry.sha256,
      method: entry.method,
      dataOffset: String(entry.dataOffset),
      dataLength: String(entry.dataLength),
    })),
    next: view.next === null ? null : String(view.next),
  };
}

/** `after` is a decimal ordinal cursor, `limit` a page size up to TREE_PAGE_LIMIT. */
function treeQuery(query: unknown): { after: number | undefined; limit: number } {
  const row: Record<string, unknown> =
    typeof query === 'object' && query !== null ? Object.fromEntries(Object.entries(query)) : {};
  const { after, limit } = row;
  if (
    Object.keys(row).some((key) => key !== 'after' && key !== 'limit') ||
    (after !== undefined && (typeof after !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(after))) ||
    (limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,3}$/.test(limit)))
  )
    throw new ArkvoryError('invalid_input', 'Invalid table of contents page');
  const size = limit === undefined ? TREE_PAGE_LIMIT : Number(limit);
  if (size > TREE_PAGE_LIMIT) throw new ArkvoryError('invalid_input', 'Invalid page limit');
  return { after: after === undefined ? undefined : Number(after), limit: size };
}

/**
 * `GET /api/v1/repositories/{repository}/artifacts/{id}/tree` (ADR 0083, N8): the table of
 * contents of an archive artifact, on the writer and on read gateways alike.
 */
export function registerTreeRoutes(
  app: FastifyInstance,
  trees: Pick<ArtifactTrees, 'page'>,
  principal: (request: FastifyRequest) => Principal,
) {
  type Params = { repository: string; id: string };
  app.get<{ Params: Params }>(
    '/api/v1/repositories/:repository/artifacts/:id/tree',
    { schema: { response: { 200: artifactTreeSchema } } },
    async (request) => {
      const { after, limit } = treeQuery(request.query);
      const { repository, id } = request.params;
      return wireTree(await trees.page(principal(request), repository, id, after, limit));
    },
  );
}

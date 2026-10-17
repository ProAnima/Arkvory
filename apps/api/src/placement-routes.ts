import type { FastifyInstance, FastifyRequest } from 'fastify';
import { placementRulesWire, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { PlacementControl, PlacementView } from '@proanima/arkvory-application';
import { storagePlacementSchema, type StoragePlacement } from '@proanima/arkvory-contracts';

/** The policy without who saved it: the wire names storages and rules, never accounts. */
export function wirePlacement(view: PlacementView): StoragePlacement {
  return {
    revision: view.revision,
    rules: placementRulesWire(view.rules),
    updatedAt: view.updatedAt,
    backends: view.backends.map(({ id, state }) => ({ id, state })),
  };
}

/** `GET|PUT /api/v1/repositories/{repository}/storage/placement` (ADR 0083, N11). */
export function registerPlacementRoutes(
  app: FastifyInstance,
  control: PlacementControl,
  principal: (request: FastifyRequest) => Principal,
) {
  type Params = { repository: string };
  const path = '/api/v1/repositories/:repository/storage/placement';
  const schema = { response: { 200: storagePlacementSchema } };
  app.get<{ Params: Params }>(path, { schema }, async (request) => {
    retentionObject(request.query, []);
    return wirePlacement(await control.get(principal(request), request.params.repository));
  });
  app.put<{ Params: Params }>(path, { schema }, async (request) => {
    retentionObject(request.query, []);
    return wirePlacement(
      await control.save(principal(request), request.params.repository, request.body),
    );
  });
}

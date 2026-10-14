import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { PostgresFleetTrust } from '@proanima/arkvory-infrastructure';
import { record } from '@proanima/arkvory-contracts';

/**
 * Routes a fleet key may call (ADR 0077): what a controller needs, nothing else. Every other
 * route refuses it, whatever the key's administrator flag says.
 */
export const fleetKeyRoutes: ReadonlySet<string> = new Set(['GET /api/v1/system/topology']);

/** The global administrator of this site, by a person's credential: not by a fleet key. */
function siteAdministrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true || actor.credential === 'fleet-key')
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
  return actor;
}

/** The pairing side of a site: codes, enrollment, the controllers it trusts (ADR 0077). */
export function registerFleetRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  site: { readonly trust: PostgresFleetTrust; readonly name: string; readonly version: string },
) {
  app.post('/api/v1/system/fleet/pairings', async (request, reply) => {
    const actor = siteAdministrator(principal(request));
    retentionObject(request.query, []);
    return reply.code(201).send(await site.trust.createPairing(actor.id));
  });
  app.get('/api/v1/system/fleet/controllers', async (request) => {
    siteAdministrator(principal(request));
    retentionObject(request.query, []);
    return { items: await site.trust.controllers() };
  });
  app.delete<{ Params: { id: string } }>(
    '/api/v1/system/fleet/controllers/:id',
    async (request, reply) => {
      siteAdministrator(principal(request));
      if (!/^[0-9a-f-]{36}$/.test(request.params.id))
        throw new ArkvoryError('not_found', 'Controller not found');
      await site.trust.revoke(request.params.id);
      return reply.code(204).send();
    },
  );
  // Public: the pairing code is the credential. Admission is bounded like sign-in.
  app.post('/api/v1/system/fleet/enrollment', async (request, reply) => {
    let body: Record<string, unknown>;
    try {
      body = record(request.body);
    } catch {
      throw new ArkvoryError('invalid_input', 'Invalid enrollment');
    }
    const enrolled = await site.trust.enroll(body['code'], body['name']);
    return reply
      .code(201)
      .send({ key: enrolled.key, site: { name: site.name, version: site.version } });
  });
}

import type { FastifyRequest } from 'fastify';
import type { Principal } from '@proanima/arkvory-domain';

/**
 * Who asks for a change: the caller, and for a fleet key the administrator of the controller it
 * names in `Arkvory-Fleet-Actor` (ADR 0077). The name is recorded, never trusted for access.
 */
export function fleetAuthor(request: FastifyRequest, actor: Principal) {
  const header = request.headers['arkvory-fleet-actor'];
  const named =
    actor.credential === 'fleet-key' && typeof header === 'string'
      ? header.replace(/[^\x20-\x7e]/g, '?').slice(0, 160)
      : '';
  return { id: actor.id, actor: named || null };
}

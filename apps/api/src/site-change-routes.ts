import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, fieldError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { readSiteChange, record } from '@proanima/arkvory-contracts';
import { fleetAuthor } from './fleet-actor.js';
import type { SiteChangeControl } from './site-change-control.js';

const ROUTE = '/api/v1/system/changes';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function administrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true)
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
}

function body(value: unknown) {
  let row: Record<string, unknown>;
  try {
    row = record(value);
  } catch {
    throw fieldError('/', 'type', 'A JSON object is required');
  }
  for (const name of Object.keys(row))
    if (!['id', 'change', 'key'].includes(name))
      throw fieldError(`/${name}`, 'unknown_field', `Unknown field: ${name}`);
  const id = row['id'];
  if (typeof id !== 'string' || !uuid.test(id))
    throw fieldError('/id', 'format', 'id is a lowercase UUID chosen by the client');
  let change;
  try {
    change = readSiteChange(row['change']);
  } catch (error) {
    throw fieldError('/change', 'invalid', error instanceof Error ? error.message : 'Invalid');
  }
  return { id, change, key: row['key'] };
}

/**
 * Changes the site's agent applies (ADR 0077, stage F3): the global administrator of the site,
 * or a controller through its fleet key. 202 means queued, not applied: the state follows in
 * `GET`. The answer never repeats the key.
 */
export function registerSiteChangeRoutes(
  app: FastifyInstance,
  principal: (r: FastifyRequest) => Principal,
  control: SiteChangeControl,
) {
  app.get(ROUTE, async (request) => {
    administrator(principal(request));
    retentionObject(request.query, []);
    return control.status();
  });
  app.post(ROUTE, async (request, reply) => {
    const actor = principal(request);
    administrator(actor);
    retentionObject(request.query, []);
    const { id, change, key } = body(request.body);
    const author = fleetAuthor(request, actor);
    const named = author.actor ? `${author.actor} (${author.id})` : author.id;
    return reply.code(202).send(await control.request(id, change, key, named));
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { readUpdateRequest } from '@proanima/arkvory-contracts';
import { UpdateControl } from './update-control.js';

export function registerUpdateRoutes(
  app: FastifyInstance,
  principal: (r: FastifyRequest) => Principal,
  directory?: string,
) {
  const control = new UpdateControl(directory);
  const authorize = (r: FastifyRequest) => {
    const actor = principal(r);
    if (actor.managed || actor.administrator !== true)
      throw new ArkvoryError('forbidden', 'Administrator required');
    retentionObject(r.query, []);
  };
  app.get('/api/v1/system/updates', async (r) => {
    authorize(r);
    return control.status();
  });
  app.post('/api/v1/system/updates/requests', async (r, reply) => {
    authorize(r);
    let request;
    try {
      request = readUpdateRequest(r.body);
    } catch {
      throw new ArkvoryError('invalid_input', 'Invalid update request');
    }
    const receipt = await control.request(request);
    return reply.code(202).send(receipt);
  });
}

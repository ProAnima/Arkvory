import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import {
  FleetControl,
  type FleetEndpointView,
  type FleetKeySeal,
  type FleetSiteClient,
  type FleetSiteStore,
} from '@proanima/arkvory-application';
import { readTopology, record } from '@proanima/arkvory-contracts';

/** A person who is the global administrator here; a fleet key never manages other sites. */
function administrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true || actor.credential === 'fleet-key')
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
  return actor;
}

/** The topology of a site is checked against the contract before it is stored or shown. */
function validating(client: FleetSiteClient): FleetSiteClient {
  return {
    origin: (url) => client.origin(url),
    certificate: (origin) => client.certificate(origin),
    enroll: (endpoint, code, name) => client.enroll(endpoint, code, name),
    topology: async (endpoint: FleetEndpointView, key: string, actor: string) => {
      const body = await client.topology(endpoint, key, actor);
      try {
        return readTopology(body);
      } catch {
        throw Object.assign(new Error('Invalid site topology'), { code: 'invalid' });
      }
    },
  };
}

function body(request: FastifyRequest) {
  try {
    return record(request.body);
  } catch {
    throw new ArkvoryError('invalid_input', 'A JSON object is required');
  }
}

const siteId = (value: string) => {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new ArkvoryError('not_found', 'Site not found');
  return value;
};

export interface FleetControlParts {
  readonly store: FleetSiteStore;
  readonly client: FleetSiteClient;
  readonly seal: FleetKeySeal | undefined;
  readonly controllerName: string;
}

/** The controller of ADR 0077, its site answers checked against the contract. */
export function createFleetControl(parts: FleetControlParts): FleetControl {
  return new FleetControl(
    parts.store,
    validating(parts.client),
    parts.seal,
    () => randomUUID(),
    parts.controllerName,
  );
}

/** The controller's routes of ADR 0077: its sites, pairing and reading them. */
export function registerFleetControlRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  control: FleetControl,
) {
  app.get('/api/v1/fleet/sites', async (request) => {
    administrator(principal(request));
    retentionObject(request.query, []);
    return { items: await control.list() };
  });
  app.post('/api/v1/fleet/sites/probe', async (request) => {
    administrator(principal(request));
    const found = await control.probe(body(request)['url']);
    return {
      url: found.url,
      certificate: found.certificate && {
        fingerprint: found.certificate.pin,
        subject: found.certificate.subject,
        issuer: found.certificate.issuer,
        validTo: found.certificate.validTo,
      },
    };
  });
  app.post('/api/v1/fleet/sites', async (request, reply) => {
    const actor = administrator(principal(request));
    const input = body(request);
    const site = await control.add({
      url: input['url'],
      pin: input['fingerprint'],
      code: input['code'],
      actor: actor.id,
    });
    return reply.code(201).send(site);
  });
  app.delete<{ Params: { id: string } }>('/api/v1/fleet/sites/:id', async (request, reply) => {
    administrator(principal(request));
    await control.remove(siteId(request.params.id));
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/v1/fleet/sites/:id/refresh', async (request) => {
    const actor = administrator(principal(request));
    const id = siteId(request.params.id);
    await control.poll(id, actor.id);
    return control.view(id);
  });
}

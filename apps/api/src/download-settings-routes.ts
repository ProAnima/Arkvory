import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  fieldError,
  nestedFields,
  readDownloadOverrides,
  retentionObject,
  requireAdministrator,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { fleetAuthor } from './fleet-actor.js';
import type { DownloadSettingsControl, DownloadSettingsView } from '@proanima/arkvory-application';
import { record } from '@proanima/arkvory-contracts';

const ROUTE = '/api/v1/system/downloads/settings';

function change(body: unknown) {
  let row: Record<string, unknown>;
  try {
    row = record(body);
  } catch {
    throw fieldError('/', 'type', 'A JSON object is required');
  }
  for (const name of Object.keys(row))
    if (name !== 'expectedRevision' && name !== 'overrides')
      throw fieldError(`/${name}`, 'unknown_field', `Unknown field: ${name}`);
  const expected = row['expectedRevision'];
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0)
    throw fieldError('/expectedRevision', 'required', 'expectedRevision is required');
  if (row['overrides'] === undefined)
    throw fieldError('/overrides', 'required', 'overrides is required');
  return {
    expected,
    overrides: nestedFields('/overrides', () => readDownloadOverrides(row['overrides'])),
  };
}

const wire = (view: DownloadSettingsView) => ({
  revision: view.revision,
  overrides: view.overrides,
  defaults: view.defaults,
  effective: view.effective,
  admission: view.admission,
  updatedAt: view.updatedAt?.toISOString() ?? null,
  updatedBy: view.updatedBy,
  actor: view.actor,
  problem: view.problem,
});

/** Download queue settings of ADR 0076 stage 3: the global administrator only. */
export function registerDownloadSettingsRoutes(
  app: FastifyInstance,
  principal: (r: FastifyRequest) => Principal,
  control: DownloadSettingsControl,
) {
  app.get(ROUTE, async (request) => {
    requireAdministrator(principal(request));
    retentionObject(request.query, []);
    return wire(await control.view());
  });
  app.put(ROUTE, async (request) => {
    const actor = principal(request);
    requireAdministrator(actor);
    retentionObject(request.query, []);
    const { expected, overrides } = change(request.body);
    return wire(await control.change(expected, overrides, fleetAuthor(request, actor)));
  });
}

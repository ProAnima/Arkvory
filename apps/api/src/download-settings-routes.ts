import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ArkvoryError,
  fieldError,
  nestedFields,
  readDownloadOverrides,
  retentionObject,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type {
  DownloadSettingsAuthor,
  DownloadSettingsControl,
  DownloadSettingsView,
} from '@proanima/arkvory-application';
import { record } from '@proanima/arkvory-contracts';

const ROUTE = '/api/v1/system/downloads/settings';

function administrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true)
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
}

/**
 * Who changes the settings: the caller, and for a fleet key the administrator of the controller
 * it names (ADR 0077). The name is recorded, never trusted for access.
 */
function author(request: FastifyRequest, actor: Principal): DownloadSettingsAuthor {
  const header = request.headers['arkvory-fleet-actor'];
  const named =
    actor.credential === 'fleet-key' && typeof header === 'string'
      ? header.replace(/[^\x20-\x7e]/g, '?').slice(0, 160)
      : '';
  return { id: actor.id, actor: named || null };
}

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
    administrator(principal(request));
    retentionObject(request.query, []);
    return wire(await control.view());
  });
  app.put(ROUTE, async (request) => {
    const actor = principal(request);
    administrator(actor);
    retentionObject(request.query, []);
    const { expected, overrides } = change(request.body);
    return wire(await control.change(expected, overrides, author(request, actor)));
  });
}

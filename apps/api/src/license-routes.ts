import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { licenceIso, licenceOverview } from '@proanima/arkvory-application';
import type { LicenceReader } from '@proanima/arkvory-application';
import { licenseViewOf } from '@proanima/arkvory-infrastructure';
import { systemLicenseSchema, type SystemLicenses } from '@proanima/arkvory-contracts';

/** The global administrator of this installation only, as for the module set. */
function administrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true)
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
}

/**
 * The licences as the core verified them, judged at effective time (ADR 0078, 8 and R2). No
 * licence key, activation secret, hub address or signature bytes leave the server; the answer
 * never waits for the hub.
 */
export async function describeLicenses(reader: LicenceReader): Promise<SystemLicenses> {
  const overview = await licenceOverview(reader);
  return {
    installation: overview.installation,
    effectiveTime: licenceIso(overview.effectiveTime),
    clockRollback: overview.clockRollback,
    pendingRequests: overview.pendingRequests,
    licenses: overview.licences.map((licence) => {
      const view = licenseViewOf(overview, licence);
      return {
        licenseId: licence.licenceId,
        activationId: licence.activationId,
        licensee: licence.licensee,
        licenseType: view.licenseType,
        activation: licence.activation,
        features: view.features,
        limits: view.limits,
        notAfter: view.notAfter,
        graceUntil: view.graceUntil,
        offlineGraceUntil: view.offlineGraceUntil,
        lastRefreshAt: view.lastRefreshAt,
        refreshFailing: view.refreshFailing,
        state: view.state,
        reason: view.reason,
      };
    }),
  };
}

/** `GET /api/v1/system/license` (ADR 0078, section 8). */
export function registerLicenseRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  reader: LicenceReader,
) {
  app.get(
    '/api/v1/system/license',
    { schema: { response: { 200: systemLicenseSchema } } },
    async (request) => {
      administrator(principal(request));
      retentionObject(request.query, []);
      return describeLicenses(reader);
    },
  );
}

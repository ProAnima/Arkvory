import {
  readFleetControllers,
  readFleetPairing,
  readFleetProbe,
  readFleetSite,
  readFleetSites,
  readTopology,
} from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

const site = (id: string) => `/api/v1/fleet/sites/${encodeURIComponent(id)}`;

/**
 * The fleet of ADR 0077. On a controller: its sites. On every site: its own topology, pairing
 * codes and the controllers it trusts. Global administrators only.
 */
export class FleetApi {
  constructor(private readonly http: HttpPort) {}

  async topology(signal?: AbortSignal) {
    return readTopology(await this.http.call('/api/v1/system/topology', 'GET', undefined, signal));
  }
  async sites(signal?: AbortSignal) {
    return readFleetSites(await this.http.call('/api/v1/fleet/sites', 'GET', undefined, signal));
  }
  async probe(url: string, signal?: AbortSignal) {
    return readFleetProbe(
      await this.http.call('/api/v1/fleet/sites/probe', 'POST', { url }, signal),
    );
  }
  async add(
    input: { url: string; fingerprint: string | null; code: string },
    signal?: AbortSignal,
  ) {
    return readFleetSite(await this.http.call('/api/v1/fleet/sites', 'POST', input, signal));
  }
  async refresh(id: string, signal?: AbortSignal) {
    return readFleetSite(await this.http.call(`${site(id)}/refresh`, 'POST', undefined, signal));
  }
  async remove(id: string, signal?: AbortSignal) {
    await this.http.call(site(id), 'DELETE', undefined, signal);
  }
  async pairing(signal?: AbortSignal) {
    return readFleetPairing(
      await this.http.call('/api/v1/system/fleet/pairings', 'POST', undefined, signal),
    );
  }
  async controllers(signal?: AbortSignal) {
    return readFleetControllers(
      await this.http.call('/api/v1/system/fleet/controllers', 'GET', undefined, signal),
    );
  }
  async revokeController(id: string, signal?: AbortSignal) {
    await this.http.call(
      `/api/v1/system/fleet/controllers/${encodeURIComponent(id)}`,
      'DELETE',
      undefined,
      signal,
    );
  }
}

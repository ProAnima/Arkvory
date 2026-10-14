import {
  readFleetControllers,
  readFleetPairing,
  readFleetProbe,
  readFleetSite,
  readFleetSites,
  readTopology,
} from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { ArkvoryClientError } from './transfer.js';
import { CatalogApi } from './catalog-api.js';
import { DiscoveryApi } from './discovery-api.js';
import { AssetsApi } from './assets-api.js';

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
  /**
   * Catalog metadata of a managed site, read through this installation with the key it holds:
   * the same calls and validating readers as for this installation's own catalog, GET only.
   */
  site(id: string) {
    const port = new SiteReadPort(this.http, id);
    const discovery = new DiscoveryApi(port);
    const catalog = new CatalogApi(port);
    const assets = new AssetsApi(port);
    return {
      repositories: discovery.repositories.bind(discovery),
      repository: discovery.repository.bind(discovery),
      search: catalog.search.bind(catalog),
      artifact: catalog.artifact.bind(catalog),
      annotations: catalog.annotations.bind(catalog),
      packages: catalog.packages.bind(catalog),
      mirror: catalog.mirror.bind(catalog),
      assetPage: assets.assetPage.bind(assets),
      asset: assets.asset.bind(assets),
      assetHistory: assets.assetHistory.bind(assets),
    };
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

/**
 * A port that sends every read to `GET /api/v1/fleet/sites/{id}/read?path=…` of this
 * installation. Anything but GET is refused before a request is made.
 */
class SiteReadPort implements HttpPort {
  constructor(
    private readonly http: HttpPort,
    private readonly id: string,
  ) {}

  private through(path: string) {
    const absolute = path.startsWith('/') ? path : `/${path}`;
    return `/api/v1/fleet/sites/${encodeURIComponent(this.id)}/read?path=${encodeURIComponent(absolute)}`;
  }

  request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    if ((init.method ?? 'GET') !== 'GET' || init.body !== undefined)
      return Promise.reject(new ArkvoryClientError('invalid_argument', 'A site is read only here'));
    return this.http.request(this.through(path), { method: 'GET' }, signal);
  }

  json(response: Response, signal?: AbortSignal, maxBytes?: number) {
    return this.http.json(response, signal, maxBytes);
  }

  async call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    if (method !== 'GET' || body !== undefined)
      throw new ArkvoryClientError('invalid_argument', 'A site is read only here');
    return this.http.call(this.through(path), 'GET', undefined, signal);
  }
}

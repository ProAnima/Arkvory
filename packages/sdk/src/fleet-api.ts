import {
  fleetChangeMethod,
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
import { UpdatesApi } from './updates-api.js';
import { DownloadSettingsApi } from './download-settings-api.js';

const absolute = (path: string) => (path.startsWith('/') ? path : `/${path}`);

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
    const port = new SitePort(this.http, id);
    const discovery = new DiscoveryApi(port);
    const catalog = new CatalogApi(port);
    const assets = new AssetsApi(port);
    const updates = new UpdatesApi(port);
    const downloads = new DownloadSettingsApi(port);
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
      /** Stage F3: the site's updater and its download queue settings. */
      updates: { status: updates.status.bind(updates), request: updates.request.bind(updates) },
      downloadSettings: {
        get: downloads.get.bind(downloads),
        change: downloads.change.bind(downloads),
      },
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
/**
 * The HTTP of one managed site through this installation: reads go through `/read`, the listed
 * changes through `/change` with the method the site expects. Anything else is refused here.
 */
class SitePort implements HttpPort {
  constructor(
    private readonly http: HttpPort,
    private readonly id: string,
  ) {}

  private through(kind: 'read' | 'change', path: string) {
    return `/api/v1/fleet/sites/${encodeURIComponent(this.id)}/${kind}?path=${encodeURIComponent(path)}`;
  }

  request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    if ((init.method ?? 'GET') !== 'GET' || init.body !== undefined)
      return Promise.reject(new ArkvoryClientError('invalid_argument', 'Only reads stream here'));
    return this.http.request(this.through('read', absolute(path)), { method: 'GET' }, signal);
  }

  json(response: Response, signal?: AbortSignal, maxBytes?: number) {
    return this.http.json(response, signal, maxBytes);
  }

  async call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const target = absolute(path);
    if (method === 'GET' && body === undefined)
      return this.http.call(this.through('read', target), 'GET', undefined, signal);
    if (fleetChangeMethod(target) !== method)
      throw new ArkvoryClientError('invalid_argument', 'This cannot be changed on a site here');
    return this.http.call(this.through('change', target), 'POST', body, signal);
  }
}

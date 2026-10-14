import type {
  FleetEndpointView,
  FleetSiteClient,
  SiteCertificateView,
} from '@proanima/arkvory-application';
import { FleetFailure, readSiteCertificate, siteOrigin, siteRequest } from './fleet-client.js';

function field(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const found: unknown = Reflect.get(value, name);
  return found;
}

/**
 * The controller's HTTP side of ADR 0077. The topology body stays `unknown` here; the API
 * validates it against the contract before it is stored or shown.
 */
export class HttpFleetSiteClient implements FleetSiteClient {
  origin(url: unknown): string {
    return siteOrigin(url);
  }

  async certificate(origin: string): Promise<SiteCertificateView | null> {
    return origin.startsWith('https:') ? readSiteCertificate(origin) : null;
  }

  async enroll(endpoint: FleetEndpointView, code: string, controllerName: string) {
    const answer = await siteRequest(endpoint, 'POST', '/api/v1/system/fleet/enrollment', {
      body: { code, name: controllerName },
    });
    if (answer.status !== 201)
      throw new FleetFailure(answer.status === 400 ? 'invalid' : 'revoked', answer.status);
    const key = field(answer.body, 'key');
    const site = field(answer.body, 'site');
    const name = field(site, 'name');
    const version = field(site, 'version');
    if (
      typeof key !== 'string' ||
      !/^afk_[A-Za-z0-9_-]{43}$/.test(key) ||
      typeof name !== 'string' ||
      typeof version !== 'string'
    )
      throw new FleetFailure('invalid', answer.status);
    return { key, name, version };
  }

  async topology(endpoint: FleetEndpointView, key: string, actor: string): Promise<unknown> {
    const answer = await siteRequest(endpoint, 'GET', '/api/v1/system/topology', { key, actor });
    if (answer.status !== 200) throw new FleetFailure('invalid', answer.status);
    return answer.body;
  }
}

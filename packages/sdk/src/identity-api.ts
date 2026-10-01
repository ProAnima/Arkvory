import { ArkvoryClientError } from './transfer.js';
import {
  items,
  record,
  text,
  readLogin,
  readPrincipal,
  readServiceBindings,
  readUserToken,
  readCreatedUserToken,
  readAuthOptions,
} from '@proanima/arkvory-contracts';
import type { UserTokenScope } from '@proanima/arkvory-contracts';

/** A string keeps the original `createToken(name, expiresAt)` call shape working. */
export type CreateTokenOptions = string | { expiresAt?: string; scope?: UserTokenScope };
import type { HttpPort } from './http-transport.js';

export class IdentityApi {
  constructor(private readonly http: HttpPort) {}
  async login(name: string, password: string) {
    return readLogin(await this.http.call('api/v1/auth/login', 'POST', { name, password }));
  }
  async permissions(signal?: AbortSignal) {
    const r = record(
      await this.http.json(
        await this.http.request('api/v1/auth/permissions', {}, signal),
        signal,
        8 * 1024 ** 2,
      ),
    );
    const profile = r['profile'];
    if (
      (profile !== 'legacy' && profile !== 'managed') ||
      typeof r['serviceAdministration'] !== 'boolean'
    )
      throw new ArkvoryClientError('invalid_response', 'Invalid permission profile');
    return {
      id: text(r['id']),
      profile,
      bindings: readServiceBindings(r['bindings'], 10000),
      serviceAdministration: r['serviceAdministration'],
      credentialId:
        r['credentialId'] === undefined || r['credentialId'] === null
          ? null
          : text(r['credentialId']),
    };
  }
  async activateServiceKey(signal?: AbortSignal) {
    await this.http.request('api/v1/auth/activate-key', { method: 'POST' }, signal);
  }
  async me() {
    return readPrincipal(await this.http.call('api/v1/auth/me'));
  }
  async logout() {
    await this.http.request('api/v1/auth/logout', { method: 'POST' });
  }
  async changePassword(currentPassword: string, newPassword: string) {
    await this.http.request('api/v1/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
  async register(name: string, password: string) {
    return readLogin(await this.http.call('api/v1/auth/register', 'POST', { name, password }));
  }
  async tokens() {
    const result = record(await this.http.call('api/v1/auth/tokens'));
    return items(result['items']).map(readUserToken);
  }
  /** Requires an interactive session; the server defaults expiry to 90 days. */
  async createToken(name: string, options?: CreateTokenOptions) {
    const { expiresAt, scope } =
      typeof options === 'string' ? { expiresAt: options } : (options ?? {});
    return readCreatedUserToken(
      await this.http.call('api/v1/auth/tokens', 'POST', {
        name,
        ...(expiresAt ? { expiresAt } : {}),
        ...(scope ? { scope } : {}),
      }),
    );
  }
  /** Public; lets a console hide registration before anyone signs in. */
  async authOptions(signal?: AbortSignal) {
    return readAuthOptions(await this.http.call('api/v1/auth/options', 'GET', undefined, signal));
  }
  async revokeToken(id: string) {
    await this.http.request(`api/v1/auth/tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

import {
  record,
  text,
  readLogin,
  readPrincipal,
  readServiceBindings,
} from '@proanima/arkvory-contracts';
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
      throw new Error('Invalid permission profile');
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
}

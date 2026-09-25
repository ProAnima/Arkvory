import { record, items, readAccount, readGroup } from '@proanima/depot-contracts';
import type { HttpPort } from './http-transport.js';

export class UsersApi {
  constructor(private readonly http: HttpPort) {}
  async users() {
    const result = record(await this.http.call('api/v1/users'));
    return items(result['items']).map(readAccount);
  }
  async createUser(name: string, password: string, administrator = false) {
    return readAccount(
      await this.http.call('api/v1/users', 'POST', { name, password, administrator }),
    );
  }
  async updateUser(id: string, update: { enabled?: boolean; password?: string }) {
    return readAccount(
      await this.http.call(`api/v1/users/${encodeURIComponent(id)}`, 'PATCH', update),
    );
  }
  async accessGroups() {
    const result = record(await this.http.call('api/v1/access-groups'));
    return items(result['items']).map(readGroup);
  }
  async createAccessGroup(name: string) {
    return readGroup(await this.http.call('api/v1/access-groups', 'POST', { name }));
  }
  async setGroupMember(groupId: string, userId: string, present: boolean) {
    await this.http.request(
      `api/v1/access-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      { method: present ? 'PUT' : 'DELETE' },
    );
  }
  async setGroupGrant(groupId: string, repository: string, access: 'read' | 'write' | null) {
    await this.http.request(
      `api/v1/access-groups/${encodeURIComponent(groupId)}/grants/${encodeURIComponent(repository)}`,
      access === null
        ? { method: 'DELETE' }
        : {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access }),
          },
    );
  }
}

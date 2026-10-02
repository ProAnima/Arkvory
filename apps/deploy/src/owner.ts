import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './model.js';
import { jsonFile } from './files.js';
import { runtimeEnvironment } from './runtime.js';
import { localRequest, localTarget } from './local-api.js';
import type { LocalTarget } from './local-api.js';

export async function createOwner(root: string, path: string): Promise<void> {
  const credentials = record(await jsonFile(path));
  const name = credentials['name'],
    password = credentials['password'];
  if (
    typeof name !== 'string' ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(name) ||
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error('Owner name and password (at least 12 characters) are required');
  const runtime = runtimeEnvironment(await jsonFile(join(root, 'config/runtime.json')));
  const target = localTarget(runtime);
  const token = await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8');
  const call = api(target, token.trim());
  const users = await call('users', 'GET');
  if (users.status !== 200) throw new Error('Cannot inspect owner setup');
  const body = record(users.json());
  if (!Array.isArray(body['items']) || body['items'].length !== 0)
    throw new Error('An account already exists; sign in or use account recovery');
  const response = await call('users', 'POST', { name, password, administrator: true });
  if (response.status !== 201 && response.status !== 200)
    throw new Error(
      `Owner creation failed (${String(response.status)}); use the recovery credential`,
    );
  const owner = record(response.json());
  if (typeof owner['id'] !== 'string') throw new Error('Invalid owner response');
  await grantInitialRepository(call, owner['id']);
  // The bootstrap key remains an offline recovery credential; never hand it to the browser automatically.
  await unlink(path);
}

type ApiCall = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<{ status: number; json(): unknown }>;

/** Bootstrap calls over the transport the installation configured (HTTP or pinned HTTPS). */
function api(target: LocalTarget, token: string): ApiCall {
  return async (path, method, body) => {
    const response = await localRequest(target, `/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: 15000,
    });
    return {
      status: response.status,
      json: (): unknown => (response.body ? JSON.parse(response.body) : null),
    };
  };
}

async function grantInitialRepository(call: ApiCall, userId: string): Promise<void> {
  const checked = async (path: string, method: string, body?: unknown) => {
    const response = await call(path, method, body);
    if (response.status < 200 || response.status > 299)
      throw new Error(
        'Owner exists, but initial repository access needs recovery through Access groups',
      );
    return response;
  };
  const group = record((await checked('access-groups', 'POST', { name: 'arkvory-owners' })).json());
  if (typeof group['id'] !== 'string') throw new Error('Invalid owner group response');
  const path = `access-groups/${encodeURIComponent(group['id'])}`;
  await checked(`${path}/grants/releases`, 'PUT', { access: 'write' });
  await checked(`${path}/members/${encodeURIComponent(userId)}`, 'PUT', {});
}

import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './model.js';
import { jsonFile } from './files.js';
import { runtimeEnvironment } from './runtime.js';
import { localApiHost } from './health.js';

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
  const port = runtime['ARKVORY_PORT'] ?? '8080';
  if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid API port');
  const token = await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8');
  const base = `http://${localApiHost(runtime['ARKVORY_HOST'])}:${port}/api/v1/`;
  const options = {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error' as const,
  };
  const users = await fetch(base + 'users', options);
  if (!users.ok) throw new Error('Cannot inspect owner setup');
  const body = record(await users.json());
  if (!Array.isArray(body['items']) || body['items'].length !== 0)
    throw new Error('An account already exists; sign in or use account recovery');
  const response = await fetch(base + 'users', {
    ...options,
    method: 'POST',
    body: JSON.stringify({ name, password, administrator: true }),
  });
  if (!response.ok)
    throw new Error(
      `Owner creation failed (${String(response.status)}); use the recovery credential`,
    );
  const owner = record(await response.json());
  if (typeof owner['id'] !== 'string') throw new Error('Invalid owner response');
  await grantInitialRepository(base, options.headers, owner['id']);
  // The bootstrap key remains an offline recovery credential; never hand it to the browser automatically.
  await unlink(path);
}

async function grantInitialRepository(
  base: string,
  headers: Record<string, string>,
  userId: string,
): Promise<void> {
  const call = async (path: string, method: string, body?: unknown): Promise<Response> => {
    const response = await fetch(base + path, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        'Owner exists, but initial repository access needs recovery through Access groups',
      );
    return response;
  };
  const group = record(
    await (await call('access-groups', 'POST', { name: 'arkvory-owners' })).json(),
  );
  if (typeof group['id'] !== 'string') throw new Error('Invalid owner group response');
  const path = `access-groups/${encodeURIComponent(group['id'])}`;
  await call(`${path}/grants/releases`, 'PUT', { access: 'write' });
  await call(`${path}/members/${encodeURIComponent(userId)}`, 'PUT', {});
}

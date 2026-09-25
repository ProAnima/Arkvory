import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './model.js';
import { jsonFile } from './files.js';
import { runtimeEnvironment } from './runtime.js';

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
  const port = runtime['DEPOT_PORT'] ?? '8080';
  if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid API port');
  const token = await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8');
  const base = `http://127.0.0.1:${port}/api/v1/`;
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
  // The bootstrap key remains an offline recovery credential; never hand it to the browser automatically.
  await unlink(path);
}

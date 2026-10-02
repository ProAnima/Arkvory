import { readFile } from 'node:fs/promises';
import { localRequest } from './local-api.js';
import type { LocalTarget } from './local-api.js';

export { localApiHost } from './local-api.js';

/** Authenticated readiness of the local API over the transport the installation configured. */
export async function healthReady(target: LocalTarget, tokenFile: string): Promise<boolean> {
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid health credential');
  const response = await localRequest(target, '/health/ready', {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 3000,
  });
  return response.status === 200;
}

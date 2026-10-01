import { readFile } from 'node:fs/promises';

/**
 * Address local tooling uses to reach the API: loopback for wildcard binds, otherwise the
 * configured interface, because a server bound to one LAN address does not answer on loopback.
 */
export function localApiHost(bindHost: string | undefined): string {
  const host = bindHost ?? '';
  if (host === '' || host === '0.0.0.0') return '127.0.0.1';
  if (host === '::' || host === '[::]') return '[::1]';
  if (!/^(?:[A-Za-z0-9.-]{1,253}|\[?[0-9A-Fa-f:.]{2,45}\]?)$/.test(host))
    throw new Error('Invalid ARKVORY_HOST');
  if (host.includes(':')) return host.startsWith('[') ? host : `[${host}]`;
  return host;
}

export async function healthReady(
  port: string,
  tokenFile: string,
  host = '127.0.0.1',
): Promise<boolean> {
  if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid health port');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid health credential');
  const response = await fetch(`http://${host}:${port}/health/ready`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  await response.body?.cancel();
  return response.ok;
}

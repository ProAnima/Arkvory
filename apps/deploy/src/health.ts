import { readFile } from 'node:fs/promises';

export async function healthReady(port: string, tokenFile: string): Promise<boolean> {
  if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid health port');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid health credential');
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  await response.body?.cancel();
  return response.ok;
}

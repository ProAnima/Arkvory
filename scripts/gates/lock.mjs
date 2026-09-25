import { open, readFile, unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function lockGates(root) {
  await mkdir(resolve(root, '.cache'), { recursive: true });
  const path = resolve(root, '.cache/gates.lock'),
    token = randomUUID();
  let file;
  try {
    file = await open(path, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another gate run owns .cache/gates.lock. If a run crashed, verify its recorded PID has stopped before removing that exact lock file.',
      );
    throw error;
  }
  try {
    await file.writeFile(
      JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
    );
  } finally {
    await file.close();
  }
  return async () => {
    const owner = JSON.parse(await readFile(path, 'utf8'));
    if (owner.token !== token) throw new Error('Gate lock ownership changed');
    await unlink(path);
  };
}

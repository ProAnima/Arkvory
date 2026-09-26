import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

export async function removeTestDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('arkvory-'))
    throw new Error('Refusing to remove a directory outside the test temp namespace');
  await rm(target, { recursive: true, force: true });
}

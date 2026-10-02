import { open } from 'node:fs/promises';

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Makes a created or renamed directory entry durable. */
export async function syncDirectory(directory: string): Promise<void> {
  // Windows has no supported directory fsync through Node. See ADR 0004.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

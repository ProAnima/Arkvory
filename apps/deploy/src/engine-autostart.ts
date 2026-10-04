import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Installation } from './model.js';
import { report } from './output.js';

/**
 * Whether Docker Desktop starts with the user's sign-in (its AutoStart setting). On Windows
 * Docker Desktop is a per-user application: until it runs, no container does, whatever its
 * restart policy, so a restarted host serves nothing. Null when it cannot be told (no Docker
 * Desktop settings: another engine, or not Windows).
 */
export async function dockerDesktopAutostart(
  appData: string | undefined = process.env['APPDATA'],
  platform: NodeJS.Platform = process.platform,
): Promise<boolean | null> {
  if (platform !== 'win32' || !appData) return null;
  for (const name of ['settings-store.json', 'settings.json']) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(join(appData, 'Docker', name), 'utf8'));
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const settings: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    const enabled = settings['AutoStart'] ?? settings['autoStart'];
    if (typeof enabled === 'boolean') return enabled;
  }
  return null;
}

/** A Compose installation on Windows warns when Docker Desktop would not start by itself. */
export async function warnEngineAutostart(state: Installation): Promise<void> {
  if (state.mode !== 'compose' || state.engine !== 'docker') return;
  if ((await dockerDesktopAutostart()) !== false) return;
  report(
    'warning',
    'Docker Desktop does not start at sign-in: after a restart of this computer Arkvory runs only once Docker Desktop is started. Enable Settings > General > "Start Docker Desktop when you sign in".',
  );
}

import { mkdir, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import { initialUpdateSnapshot } from './update-monitor.js';

export async function prepareUpdateControl(root: string): Promise<void> {
  for (const directory of ['updates', 'updates/status', 'updates/inbox']) {
    await mkdir(join(root, directory), { recursive: true, mode: 0o755 });
    // Installer umask may be 0077. The service must still traverse the read-only status mount.
    await chmod(join(root, directory), 0o755);
  }
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  if (state.mode === 'compose') {
    // Host updater and container UID can differ. The private host root is the access boundary;
    // only this bind-mounted inbox is shared, never the root-owned status or installation files.
    await chmod(root, 0o700);
    await chmod(join(root, 'updates/inbox'), 0o777);
  }
  const path = join(root, 'updates/status/snapshot.json');
  try {
    await access(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    await atomicJson(path, initialUpdateSnapshot(state, new Date().toISOString()));
  }
  const config = join(root, 'config/runtime.json');
  const env = runtimeEnvironment(await jsonFile(config));
  env['DEPOT_UPDATE_CONTROL_DIR'] =
    state.mode === 'compose' ? '/run/depot-updates' : join(root, 'updates');
  await atomicJson(config, env);
  await chmod(config, state.mode === 'compose' ? 0o644 : 0o640);
}

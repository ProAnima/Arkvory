import { mkdir, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import { initialUpdateSnapshot } from './update-monitor.js';

export async function prepareUpdateControl(root: string): Promise<void> {
  for (const directory of ['updates', 'updates/status', 'updates/inbox'])
    await mkdir(join(root, directory), { recursive: true, mode: 0o755 });
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
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

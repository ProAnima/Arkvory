import { rename, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { readUpdateSnapshot, readUpdateRequest } from '@proanima/arkvory-contracts';
import type { UpdateSnapshot } from '@proanima/arkvory-contracts';
import { atomicJson, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import { selectRelease } from './staging.js';
import { hubSettings, saveHubSettings } from './hub-settings.js';
import { monitorUpdates } from './update-monitor.js';
import { update, save, checkJournal } from './operations.js';

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
/** The API owns only the inbox. Accepted commands and installation files remain privileged. */
export async function pollUpdates(root: string): Promise<void> {
  await checkJournal(root);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const path = join(root, 'updates/status/snapshot.json');
  const previous = readUpdateSnapshot(await jsonFile(path));
  const accepted = join(root, 'update-request.json');
  try {
    await access(accepted);
    throw new Error('Interrupted update request; inspect installation and use updates-reset');
  } catch (error) {
    if (!missing(error)) throw error;
  }
  let request = null;
  try {
    await rename(join(root, 'updates/inbox/request.json'), accepted);
    request = readUpdateRequest(await jsonFile(accepted));
  } catch (error) {
    if (!missing(error)) throw error;
  }
  // The last saved snapshot, re-saved with a fresh heartbeat while an update waits for a backup.
  let last: UpdateSnapshot = previous;
  const beat = () => atomicJson(path, { ...last, heartbeatAt: new Date().toISOString() });
  const hub = await hubSettings(root);
  await monitorUpdates(
    state,
    previous,
    request,
    new Date().toISOString(),
    {
      save: async (snapshot) => {
        last = { ...snapshot };
        await atomicJson(path, snapshot);
      },
      // The hub's answer for this installation; GitHub only when the hub cannot be reached.
      resolve: async () =>
        (await selectRelease(root, null, state.current, AbortSignal.timeout(60000))).selected
          ?.release ?? state.current,
      configure: async (automatic, statistics) => {
        await save(root, { ...state, automatic });
        if (statistics !== undefined) await saveHubSettings(root, { ...hub, statistics });
      },
      apply: async (version, digest) => {
        await update(root, new Map([['version', version]]), digest, beat);
        return parseInstallation(await jsonFile(join(root, 'installation.json')));
      },
    },
    hub,
  );
  if (request) await unlink(accepted);
}
export async function resetUpdateRequest(root: string): Promise<void> {
  await checkJournal(root);
  await unlink(join(root, 'update-request.json')).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
}

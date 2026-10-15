import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readUpdateSnapshot, readUpdateRequest } from '@proanima/arkvory-contracts';
import type { UpdateRequest, UpdateSnapshot } from '@proanima/arkvory-contracts';
import { atomicJson, exists, jsonFile } from './files.js';
import { claim, missing, readClaimed, removeName } from './mailbox-claim.js';
import { report } from './output.js';
import { parseInstallation } from './model.js';
import { selectRelease } from './staging.js';
import { hubSettings, saveHubSettings } from './hub-settings.js';
import { monitorUpdates } from './update-monitor.js';
import { update, save, checkJournal } from './operations.js';

/** Far above any request the API writes; the size of what is read stays bounded. */
const REQUEST_LIMIT = 16384;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const readAccepted = async (path: string) =>
  readUpdateRequest(JSON.parse(await readClaimed(path, REQUEST_LIMIT)));

/**
 * The request to run on this tick: null when there is none, 'dropped' when one was refused or
 * unreadable. A dropped request is removed, never retried: it is the inbox's writers' input, and
 * keeping it would stop every later tick. A readable request accepted on an earlier tick may have
 * started an update, so only an operator clears it (updates-reset).
 */
async function acceptRequest(root: string): Promise<UpdateRequest | null | 'dropped'> {
  const accepted = join(root, 'update-request.json');
  const held = await exists(accepted);
  try {
    if (!held && !(await claim(join(root, 'updates/inbox/request.json'), accepted))) return null;
    const request = await readAccepted(accepted);
    if (!held) return request;
  } catch (error) {
    await removeName(accepted);
    report('warning', `Dropped an unreadable update request: ${message(error)}`);
    return 'dropped';
  }
  throw new Error('Interrupted update request; inspect installation and use updates-reset');
}
/** The API owns only the inbox. Accepted commands and installation files remain privileged. */
export async function pollUpdates(root: string): Promise<void> {
  await checkJournal(root);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const path = join(root, 'updates/status/snapshot.json');
  const saved = readUpdateSnapshot(await jsonFile(path));
  const claimed = await acceptRequest(root);
  const request = claimed === 'dropped' ? null : claimed;
  // The console sees the refusal; the next successful check clears it.
  const previous: UpdateSnapshot =
    claimed === 'dropped' ? { ...saved, phase: 'failed', error: 'update_failed' } : saved;
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
  if (request) await unlink(join(root, 'update-request.json'));
}
export async function resetUpdateRequest(root: string): Promise<void> {
  await checkJournal(root);
  await unlink(join(root, 'update-request.json')).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
}

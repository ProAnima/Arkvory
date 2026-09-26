import { rename, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { readUpdateSnapshot, readUpdateRequest } from '@proanima/arkvory-contracts';
import { atomicJson, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import { GitHubReleases } from './github.js';
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
  await monitorUpdates(state, previous, request, new Date().toISOString(), {
    save: (snapshot) => atomicJson(path, snapshot),
    resolve: async () =>
      (
        await (
          await GitHubReleases.fromTokenFile(
            join(root, 'github-token.txt'),
            AbortSignal.timeout(30000),
          )
        ).resolve(null)
      ).release,
    configure: async (automatic) => {
      await save(root, { ...state, automatic });
    },
    apply: async (version, digest) => {
      await update(root, new Map([['version', version]]), digest);
      return parseInstallation(await jsonFile(join(root, 'installation.json')));
    },
  });
  if (request) await unlink(accepted);
}
export async function resetUpdateRequest(root: string): Promise<void> {
  await checkJournal(root);
  await unlink(join(root, 'update-request.json')).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
}

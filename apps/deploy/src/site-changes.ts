import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readSiteChangeRequest,
  readSiteChangeStatus,
  SITE_CHANGE_TTL_MS,
} from '@proanima/arkvory-contracts';
import type {
  SiteChange,
  SiteChangeRecord,
  SiteChangeRequest,
  SiteChangeStatus,
} from '@proanima/arkvory-contracts';
import { atomicJson, exists, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import type { Installation } from './model.js';
import { configureMirror } from './mirror-setup.js';
import type { MirrorChange } from './mirror-setup.js';
import { finishSwitchover, switchover } from './cluster-ops.js';
import { decideSingleCopy } from './replica-service.js';
import { Services } from './services.js';
import { report } from './output.js';

/** What applies a change; tests pass their own. */
export interface ChangeActions {
  mirror(state: Installation, change: MirrorChange): Promise<unknown>;
  switchover(node: string): Promise<void>;
  /** Clears a switchover a stopped agent left; true when Arkvory runs on `node`. */
  finishSwitchover(node: string): Promise<boolean>;
  singleCopy(options: ReadonlyMap<string, string>): Promise<void>;
}

export function systemActions(root: string): ChangeActions {
  return {
    mirror: (state, change) => configureMirror(root, state, change, new Services(root, state)),
    switchover: (node) => switchover(node),
    finishSwitchover: (node) => finishSwitchover(node),
    singleCopy: (options) => decideSingleCopy(root, options),
  };
}

/** The API's side of the mailbox lives in `updates/inbox`; claimed files only in the root. */
const files = (root: string) => ({
  request: join(root, 'updates/inbox/change.json'),
  key: join(root, 'updates/inbox/change.key'),
  status: join(root, 'updates/status/changes.json'),
  claimed: join(root, 'change-request.json'),
  claimedKey: join(root, 'change.key'),
  certificate: join(root, 'change-ca.pem'),
});

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
/** Messages of configure and cluster commands name files and nodes, never keys. */
const reason = (error: unknown) =>
  (error instanceof Error ? error.message : 'failed').replace(/\s+/g, ' ').slice(0, 300);

async function claim(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function readStatus(path: string): Promise<SiteChangeStatus> {
  try {
    return readSiteChangeStatus(await jsonFile(path));
  } catch (error) {
    if (missing(error)) return { heartbeatAt: new Date(0).toISOString(), recent: [] };
    throw error;
  }
}

function record(request: SiteChangeRequest, state: SiteChangeRecord['state'], error?: string) {
  return {
    id: request.id,
    kind: request.change.kind,
    state,
    error: error ?? null,
    actor: request.actor,
    requestedAt: request.requestedAt,
    finishedAt: state === 'done' || state === 'failed' ? new Date().toISOString() : null,
  } satisfies SiteChangeRecord;
}

async function apply(
  root: string,
  change: SiteChange,
  actions: ChangeActions,
  paths: ReturnType<typeof files>,
) {
  const state = () =>
    jsonFile(join(root, 'installation.json')).then((value) => parseInstallation(value));
  switch (change.kind) {
    case 'mirror-attach': {
      if (!(await exists(paths.claimedKey))) throw new Error('The source key did not arrive');
      if (change.certificate !== null)
        await writeFile(paths.certificate, change.certificate, { mode: 0o600 });
      await actions.mirror(await state(), {
        repository: change.repository,
        upstream: change.upstream,
        sourceRepository: change.sourceRepository,
        tokenFile: paths.claimedKey,
        ...(change.stages ? { stages: change.stages } : {}),
        ...(change.certificate !== null ? { caFile: paths.certificate } : {}),
      });
      return;
    }
    case 'mirror-key':
      if (!(await exists(paths.claimedKey))) throw new Error('The source key did not arrive');
      await actions.mirror(await state(), {
        repository: change.repository,
        tokenFile: paths.claimedKey,
      });
      return;
    case 'mirror-detach':
      await actions.mirror(await state(), { detach: change.repositories.join(',') });
      return;
    case 'cluster-switchover':
      await actions.switchover(change.node);
      return;
    case 'single-copy':
      await actions.singleCopy(
        change.until === null
          ? new Map([['off', '']])
          : new Map([
              ['until', change.until],
              ['reason', change.reason],
            ]),
      );
  }
}

/**
 * One tick of the site's change mailbox (ADR 0077, stage F3), under the installation lock after
 * the update tick. One request at a time; its id is remembered, so a repeated request is not
 * applied twice. The source key, when any, is read from its own file and removed in every case.
 */
export async function pollChanges(
  root: string,
  actions: ChangeActions = systemActions(root),
  now: () => number = Date.now,
): Promise<void> {
  const paths = files(root);
  if (!(await exists(join(root, 'updates/status')))) return;
  let status = await readStatus(paths.status);
  const save = async (entry?: SiteChangeRecord) => {
    const recent = entry
      ? [entry, ...status.recent.filter((item) => item.id !== entry.id)].slice(0, 20)
      : status.recent;
    status = { heartbeatAt: new Date(now()).toISOString(), recent };
    await atomicJson(paths.status, status);
  };
  try {
    await resume(paths, actions, save);
    if (!(await claim(paths.request, paths.claimed))) return;
    await claim(paths.key, paths.claimedKey);
    let request: SiteChangeRequest;
    try {
      request = readSiteChangeRequest(await jsonFile(paths.claimed));
    } catch (error) {
      report('warning', `Dropped an unreadable change request: ${reason(error)}`);
      return;
    }
    if (status.recent.some((item) => item.id === request.id)) return;
    if (now() - Date.parse(request.requestedAt) > SITE_CHANGE_TTL_MS) {
      await save(record(request, 'failed', 'The request expired before the agent took it'));
      return;
    }
    // Recorded before applying: a switchover stops this agent, the next tick finishes it.
    await save(record(request, 'applying'));
    try {
      await apply(root, request.change, actions, paths);
      await save(record(request, 'done'));
      report('info', `Applied ${request.change.kind} ${request.id} for ${request.actor}`);
    } catch (error) {
      await save(record(request, 'failed', reason(error)));
      report('warning', `Change ${request.change.kind} ${request.id} failed: ${reason(error)}`);
    }
  } finally {
    // The key never outlives the tick, whatever happened.
    await rm(paths.claimedKey, { force: true });
    await rm(paths.certificate, { force: true });
    await rm(paths.claimed, { force: true });
    await save();
  }
}

/** A request this agent claimed and did not finish: a switchover moved it, or it stopped. */
async function resume(
  paths: ReturnType<typeof files>,
  actions: ChangeActions,
  save: (entry: SiteChangeRecord) => Promise<void>,
) {
  if (!(await exists(paths.claimed))) return;
  let request: SiteChangeRequest;
  try {
    request = readSiteChangeRequest(await jsonFile(paths.claimed));
  } catch {
    await rm(paths.claimed, { force: true });
    return;
  }
  if (request.change.kind === 'cluster-switchover') {
    const moved = await actions.finishSwitchover(request.change.node);
    await save(
      moved
        ? record(request, 'done')
        : record(request, 'failed', `Arkvory did not move to ${request.change.node}`),
    );
  } else
    await save(
      record(
        request,
        'failed',
        'The agent stopped while applying; check the configuration with arkvory status',
      ),
    );
  await rm(paths.claimed, { force: true });
}

import { join } from 'node:path';
import { readSiteChangeRequest, siteChangeTtlMs } from '@proanima/arkvory-contracts';
import type {
  SiteChange,
  SiteChangeError,
  SiteChangeRecord,
  SiteChangeRequest,
  SiteChangeStatus,
} from '@proanima/arkvory-contracts';
import { exists, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import type { Installation } from './model.js';
import { attachedMirrors, configureMirror } from './mirror-setup.js';
import type { MirrorChange } from './mirror-setup.js';
import { finishSwitchover, switchover } from './cluster-ops.js';
import { decideSingleCopy } from './replica-service.js';
import { Services } from './services.js';
import { report } from './output.js';
import { isUnconfirmedTermination } from './process.js';
import {
  claim,
  KEY_LIMIT,
  mailbox,
  readClaimed,
  readStatus,
  removeAll,
  REQUEST_LIMIT,
  sweep,
  writeStatus,
  type Mailbox,
} from './site-change-files.js';

/** What applies a change; tests pass their own. */
export interface ChangeActions {
  mirror(state: Installation, change: MirrorChange): Promise<unknown>;
  attached(state: Installation): Promise<readonly string[]>;
  switchover(node: string): Promise<void>;
  /** Clears a switchover's move constraint; true when Arkvory runs on `node`. */
  finishSwitchover(node: string): Promise<boolean>;
  singleCopy(options: ReadonlyMap<string, string>): Promise<void>;
}

export function systemActions(root: string): ChangeActions {
  return {
    mirror: (state, change) => configureMirror(root, state, change, new Services(root, state)),
    attached: (state) => attachedMirrors(root, state),
    switchover: (node) => switchover(node),
    finishSwitchover: (node) => finishSwitchover(node),
    singleCopy: (options) => decideSingleCopy(root, options),
  };
}

const message = (error: unknown) =>
  (error instanceof Error ? error.message : 'failed').replace(/\s+/g, ' ').slice(0, 300);

function record(
  request: SiteChangeRequest,
  state: SiteChangeRecord['state'],
  error: SiteChangeError | null = null,
): SiteChangeRecord {
  return {
    id: request.id,
    digest: request.digest,
    kind: request.change.kind,
    state,
    error,
    actor: request.actor,
    requestedAt: request.requestedAt,
    finishedAt: state === 'done' || state === 'failed' ? new Date().toISOString() : null,
  };
}

/** A refusal the agent decided itself, with the code the status carries. */
class Refused extends Error {
  constructor(readonly code: SiteChangeError) {
    super(code);
  }
}
const failureOf = (change: SiteChange, error: unknown): SiteChangeError =>
  error instanceof Refused
    ? error.code
    : change.kind === 'cluster-switchover'
      ? 'switchover_failed'
      : change.kind === 'single-copy'
        ? 'single_copy_failed'
        : 'mirror_failed';

const installation = async (root: string) =>
  parseInstallation(await jsonFile(join(root, 'installation.json')));

async function applyMirror(
  root: string,
  change: Extract<SiteChange, { kind: 'mirror-attach' | 'mirror-key' | 'mirror-detach' }>,
  actions: ChangeActions,
  secret: string | null,
) {
  const state = await installation(root);
  const attached = await actions.attached(state);
  if (change.kind === 'mirror-detach') {
    if (!change.repositories.every((name) => attached.includes(name)))
      throw new Refused('not_a_mirror');
    await actions.mirror(state, { detach: change.repositories.join(',') });
    return;
  }
  if (secret === null) throw new Refused('key_missing');
  if (change.kind === 'mirror-key') {
    if (!attached.includes(change.repository)) throw new Refused('not_a_mirror');
    await actions.mirror(state, { repository: change.repository, secret });
    return;
  }
  // A new repository only: a mode or a source is never changed by a remote omission.
  if (attached.includes(change.repository)) throw new Refused('already_attached');
  await actions.mirror(state, {
    repository: change.repository,
    upstream: change.upstream,
    sourceRepository: change.sourceRepository,
    secret,
    ...(change.stages ? { stages: change.stages } : {}),
  });
}

async function apply(
  root: string,
  change: SiteChange,
  actions: ChangeActions,
  secret: string | null,
) {
  switch (change.kind) {
    case 'mirror-attach':
    case 'mirror-key':
    case 'mirror-detach':
      return applyMirror(root, change, actions, secret);
    case 'cluster-switchover':
      try {
        await actions.switchover(change.node);
      } catch (error) {
        // The move may have succeeded while clearing its constraint failed: the outcome is
        // where Arkvory runs now.
        if (!(await actions.finishSwitchover(change.node).catch(() => false))) throw error;
      }
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

interface Tick {
  readonly root: string;
  readonly box: Mailbox;
  readonly actions: ChangeActions;
  readonly now: () => number;
  status: SiteChangeStatus;
}

async function save(tick: Tick, entry?: SiteChangeRecord, blocked = tick.status.blocked) {
  const recent = entry
    ? [entry, ...tick.status.recent.filter((item) => item.id !== entry.id)].slice(0, 20)
    : tick.status.recent;
  tick.status = { heartbeatAt: new Date(tick.now()).toISOString(), blocked, recent };
  await writeStatus(tick.box.status, tick.status);
}

/** The request this agent claimed before and did not finish, if any. */
async function claimedRequest(box: Mailbox): Promise<SiteChangeRequest | null> {
  if (!(await exists(box.claimed))) return null;
  try {
    return readSiteChangeRequest(JSON.parse(await readClaimed(box.claimed, REQUEST_LIMIT)));
  } catch {
    await removeAll([box.claimed]);
    return null;
  }
}

/**
 * A request claimed and not finished. A switchover moves this agent with Arkvory: the next tick,
 * on the new node, finishes it, retrying while the request is young. Anything else stopped half
 * done blocks further changes until an operator checked the site (`arkvory changes-reset`).
 */
async function resume(tick: Tick): Promise<'go' | 'retry' | 'blocked'> {
  const request = await claimedRequest(tick.box);
  if (!request) return 'go';
  if (request.change.kind !== 'cluster-switchover') {
    await save(tick, record(request, 'failed', 'interrupted'), 'interrupted');
    return 'blocked';
  }
  try {
    const moved = await tick.actions.finishSwitchover(request.change.node);
    await save(
      tick,
      record(request, moved ? 'done' : 'failed', moved ? null : 'switchover_failed'),
    );
  } catch (error) {
    report('warning', `Switchover ${request.id} not finished yet: ${message(error)}`);
    if (tick.now() - Date.parse(request.requestedAt) < siteChangeTtlMs(request.change.kind))
      return 'retry';
    await save(tick, record(request, 'failed', 'switchover_failed'));
  }
  return 'go';
}

/** Claims the next request with its own key; null when there is none or it was refused. */
async function next(
  tick: Tick,
): Promise<{ request: SiteChangeRequest; secret: string | null } | null> {
  const { box } = tick;
  try {
    if (!(await claim(box.request, box.claimed))) return null;
  } catch (error) {
    report('warning', `Refused a change request: ${message(error)}`);
    return null;
  }
  let request: SiteChangeRequest;
  try {
    request = readSiteChangeRequest(JSON.parse(await readClaimed(box.claimed, REQUEST_LIMIT)));
  } catch (error) {
    report('warning', `Dropped an unreadable change request: ${message(error)}`);
    return null;
  }
  let secret: string | null = null;
  try {
    if (await claim(box.key(request.id), box.claimedKey)) {
      secret = (await readClaimed(box.claimedKey, KEY_LIMIT)).trim();
      if (!/^[\x21-\x7e]{16,4000}$/.test(secret)) secret = null;
    }
  } catch (error) {
    report('warning', `Refused the key of ${request.id}: ${message(error)}`);
  }
  return { request, secret };
}

async function run(tick: Tick, request: SiteChangeRequest, secret: string | null) {
  if (tick.status.recent.some((item) => item.id === request.id)) return;
  // Too old, or from a clock far ahead: decided about a site that may have changed since.
  const age = tick.now() - Date.parse(request.requestedAt);
  if (Math.abs(age) > siteChangeTtlMs(request.change.kind)) {
    await save(tick, record(request, 'failed', 'expired'));
    return;
  }
  // Recorded before applying: a switchover stops this agent, the next tick finishes it.
  await save(tick, record(request, 'applying'));
  try {
    await apply(tick.root, request.change, tick.actions, secret);
    await save(tick, record(request, 'done'));
    report('info', `Applied ${request.change.kind} ${request.id} for ${request.actor}`);
  } catch (error) {
    const unconfirmed = isUnconfirmedTermination(error);
    await save(
      tick,
      record(request, 'failed', unconfirmed ? 'interrupted' : failureOf(request.change, error)),
      unconfirmed ? 'interrupted' : tick.status.blocked,
    );
    // The agent's own words stay in its log on this site; the status carries a code.
    report('warning', `Change ${request.change.kind} ${request.id} failed: ${message(error)}`);
    // A command that may still run keeps the installation lock for an operator.
    if (unconfirmed) throw error;
  }
}

/**
 * One tick of the site's change mailbox (ADR 0077, stage F3), under the installation lock after
 * the update tick: one request at a time, its id remembered, its key read once and removed
 * whatever happens. The heartbeat is written on every tick that reaches the end.
 */
export async function pollChanges(
  root: string,
  actions: ChangeActions = systemActions(root),
  now: () => number = Date.now,
): Promise<void> {
  const box = mailbox(root);
  if (!(await exists(join(root, 'updates/status')))) return;
  const tick: Tick = { root, box, actions, now, status: await readStatus(box.status) };
  // The claim outlives the tick only for a switchover to finish on the next one; a process
  // killed mid-change leaves it too, and the next tick blocks on it.
  let keep = false;
  try {
    await sweep(box, now());
    if (tick.status.blocked !== null) return;
    const resumed = await resume(tick);
    keep = resumed === 'retry';
    if (resumed !== 'go') return;
    const taken = await next(tick);
    if (taken) await run(tick, taken.request, taken.secret);
  } finally {
    await removeAll([box.claimedKey, ...(keep ? [] : [box.claimed])]);
    await save(tick);
  }
}

/** `arkvory changes-reset`: after checking the site, lets the agent take changes again. */
export async function resetChanges(root: string): Promise<void> {
  const box = mailbox(root);
  const status = await readStatus(box.status);
  await removeAll([box.claimed, box.claimedKey]);
  await writeStatus(box.status, { ...status, blocked: null });
  report('info', 'Site changes are taken again');
}

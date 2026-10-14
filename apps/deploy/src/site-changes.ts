import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  readSiteChangeRequest,
  siteChangeDigestText,
  siteChangeTtlMs,
} from '@proanima/arkvory-contracts';
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
import { finishSwitchover, switchover, SwitchoverIncomplete, systemTool } from './cluster-ops.js';
import { decideSingleCopy } from './replica-service.js';
import { Services } from './services.js';
import { report } from './output.js';
import { isUnconfirmedTermination } from './process.js';
import { checkJournal } from './operations.js';
import {
  claim,
  keepUnreadable,
  KEY_LIMIT,
  mailbox,
  markMoving,
  movingFor,
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
  /** `moving` runs right before the move constraint is set: it records that a move may exist. */
  switchover(node: string, moving: () => Promise<void>): Promise<void>;
  /** Clears a switchover's move constraint; true when Arkvory runs on `node`. */
  finishSwitchover(node: string): Promise<boolean>;
  singleCopy(options: ReadonlyMap<string, string>): Promise<void>;
}

export function systemActions(root: string): ChangeActions {
  return {
    mirror: (state, change) => configureMirror(root, state, change, new Services(root, state)),
    attached: (state) => attachedMirrors(root, state),
    switchover: (node, moving) => switchover(node, systemTool, moving),
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
  moving: () => Promise<void>,
) {
  switch (change.kind) {
    case 'mirror-attach':
    case 'mirror-key':
    case 'mirror-detach':
      return applyMirror(root, change, actions, secret);
    case 'cluster-switchover':
      try {
        await actions.switchover(change.node, moving);
      } catch (error) {
        // Refused before the move: nothing to finish, and clearing would drop the operator's
        // own constraints. After the move the outcome is where Arkvory runs now.
        if (!(error instanceof SwitchoverIncomplete)) throw error;
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
  // Killed after recording the outcome, before dropping the claim: nothing is left to do.
  const known = tick.status.recent.find((item) => item.id === request.id);
  if (known && (known.state === 'done' || known.state === 'failed')) return 'go';
  // A switchover killed before its marker never issued `--move`: there is no constraint of
  // its own to clear, and `--clear` would drop the operator's. Interrupted like any other.
  if (
    request.change.kind !== 'cluster-switchover' ||
    !(await movingFor(tick.box.moving, request.id))
  ) {
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

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** The digest the API wrote (ADR 0077), recomputed from the change and the key that arrived. */
export const requestDigest = (change: SiteChange, secret: string | null) =>
  sha256(siteChangeDigestText(change, secret === null ? null : sha256(secret)));
/**
 * The inbox is writable by more than the API: a request or key replaced there would carry the
 * id of another. A missing key of a change that needs one is left to `key_missing`; any key that
 * did arrive must be the one the digest names.
 */
const tampered = (request: SiteChangeRequest, secret: string | null) => {
  const needsKey = request.change.kind === 'mirror-attach' || request.change.kind === 'mirror-key';
  return (secret !== null || !needsKey) && requestDigest(request.change, secret) !== request.digest;
};

async function run(tick: Tick, request: SiteChangeRequest, secret: string | null) {
  if (tick.status.recent.some((item) => item.id === request.id)) return;
  if (tampered(request, secret)) {
    await save(tick, record(request, 'failed', 'digest_mismatch'));
    report('warning', `Refused change ${request.id}: its digest does not match`);
    return;
  }
  // Too old, or from a clock far ahead: decided about a site that may have changed since.
  const age = tick.now() - Date.parse(request.requestedAt);
  if (Math.abs(age) > siteChangeTtlMs(request.change.kind)) {
    await save(tick, record(request, 'failed', 'expired'));
    return;
  }
  // Recorded before applying: a switchover stops this agent, the next tick finishes it.
  await save(tick, record(request, 'applying'));
  try {
    await apply(tick.root, request.change, tick.actions, secret, () =>
      markMoving(tick.box.moving, request.id),
    );
    await save(tick, record(request, 'done'));
    report('info', `Applied ${request.change.kind} ${request.id} for ${request.actor}`);
  } catch (error) {
    const unconfirmed = isUnconfirmedTermination(error);
    // Recording must not replace the error: an unconfirmed one keeps the installation lock.
    await save(
      tick,
      record(request, 'failed', unconfirmed ? 'interrupted' : failureOf(request.change, error)),
      unconfirmed ? 'interrupted' : tick.status.blocked,
    ).catch((failure: unknown) => {
      report('warning', `Could not record change ${request.id}: ${message(failure)}`);
    });
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
  // A deployment left half done (an update killed mid-way) is no installation to change: its
  // recovery comes first, as for `changes-reset`.
  await checkJournal(root);
  const tick: Tick = { root, box, actions, now, status: await statusOrBlocked(box) };
  // The claim outlives the tick only for a switchover to finish on the next one; a process
  // killed mid-change leaves it too, and the next tick blocks on it.
  let keep = false;
  try {
    await sweep(box, now());
    // Behind a barrier the claim stays as found (an unreadable status may hide a switchover
    // still to finish): only `changes-reset`, after an operator looked, removes it.
    keep = tick.status.blocked !== null;
    if (keep) return;
    const resumed = await resume(tick);
    keep = resumed === 'retry';
    if (resumed !== 'go') return;
    const taken = await next(tick);
    if (taken) await run(tick, taken.request, taken.secret);
  } finally {
    await removeAll([box.claimedKey, ...(keep ? [] : [box.claimed, box.moving])]);
    // The heartbeat must not hide the error of the tick, nor a lock-keeping one.
    await save(tick).catch((failure: unknown) => {
      report('warning', `Could not write the change status: ${message(failure)}`);
    });
  }
}

/**
 * The status as written, or, when this release cannot read it (written by another version, or
 * damaged), an empty one that blocks until an operator looked: the barrier is never lost, and
 * the original is kept beside it (`changes.json.unreadable`) instead of being overwritten.
 */
async function statusOrBlocked(box: Mailbox): Promise<SiteChangeStatus> {
  try {
    return await readStatus(box.status);
  } catch (error) {
    report('warning', `The change status cannot be read: ${message(error)}`);
    await keepUnreadable(box.status);
    return { heartbeatAt: new Date(0).toISOString(), blocked: 'unreadable', recent: [] };
  }
}

/**
 * `arkvory changes-reset`: after checking the site, lets the agent take changes again. A change
 * left `applying` (a switchover whose retries were cut short) ends as interrupted, so no console
 * follows it forever.
 */
export async function resetChanges(root: string): Promise<void> {
  await checkJournal(root);
  const box = mailbox(root);
  const status = await statusOrBlocked(box);
  await removeAll([box.claimed, box.claimedKey, box.moving]);
  await writeStatus(box.status, {
    heartbeatAt: new Date().toISOString(),
    blocked: null,
    recent: status.recent.map((item) =>
      item.state === 'applying' || item.state === 'pending'
        ? { ...item, state: 'failed', error: 'interrupted', finishedAt: new Date().toISOString() }
        : item,
    ),
  });
  report('info', 'Site changes are taken again');
}

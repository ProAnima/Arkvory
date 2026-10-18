import {
  effectiveLicenceTime,
  licenceRefreshAt,
  licenceRetryDelay,
  licenceRetryable,
} from '@proanima/arkvory-domain';
import { LicenceDocumentRefused } from './licence-ports.js';
import type {
  LicenceEnvironment,
  LicenceHubAnswer,
  LicenceRefreshBody,
  LicenceSignal,
  LicenceStore,
  StoredActivation,
  VerifiedLicenceToken,
} from './licence-ports.js';

/**
 * Online activation, refresh and release of licences through the hub (ADR 0078, R2). Each
 * exchange runs alone (`LicenceStore.exclusive`): the hub takes one secret once, and a second
 * request with it would look like a cloned installation. A document is kept only after its
 * signature, chain, installation, nonce and `seq` were checked; an answer without a valid
 * signature changes nothing but the recorded failure.
 */
export type LicenceExchangeResult =
  | {
      readonly outcome: 'activated' | 'refreshed';
      readonly activationId: string;
      readonly licenceId: string;
      readonly seq: number;
      readonly notAfter: number;
    }
  | {
      readonly outcome: 'revoked';
      readonly activationId: string;
      readonly licenceId: string;
      readonly reason: string;
    }
  | {
      readonly outcome: 'refused' | 'failed';
      readonly code: string;
      readonly activationId?: string;
      readonly nextAttemptAt?: number | null;
    }
  | { readonly outcome: 'released'; readonly activationId: string }
  | { readonly outcome: 'busy' };

/** How long the hub takes the previous secret again for a lost answer (its RETRY_WINDOW). */
export const LICENCE_RETRY_WINDOW_MS = 10 * 60 * 1000;
/** Repeats of a request whose answer was lost, inside the hub's window, with the same nonce. */
const LOST_ANSWER_DELAYS_MS = [5_000, 30_000];
/** How long an operator's command waits for an exchange of the worker to finish. */
export const LICENCE_LOCK_WAIT_MS = 120_000;
const ISO_SECOND = 19;

export const licenceIso = (ms: number) => `${new Date(ms).toISOString().slice(0, ISO_SECOND)}Z`;

/** Effective time (ADR 0078, 6.4): never before what the installation already saw. */
export async function effectiveNow(store: LicenceStore): Promise<number> {
  const [now, clock] = await Promise.all([store.databaseNow(), store.clock()]);
  return effectiveLicenceTime(now, clock.maxSeen, clock.maxIssued);
}

const refused = (code: string, activationId?: string): LicenceExchangeResult => ({
  outcome: 'refused',
  code,
  ...(activationId === undefined ? {} : { activationId }),
});

function verified(env: LicenceEnvironment, text: string): VerifiedLicenceToken | string {
  try {
    return env.verifier.token(text, 'activation');
  } catch (error) {
    if (error instanceof LicenceDocumentRefused) return `${error.failure}_${error.code}`;
    throw error;
  }
}

const tokenRecord = (env: LicenceEnvironment, token: VerifiedLicenceToken, text: string) => ({
  activationId: token.activationId,
  licenceId: token.licenceId,
  installation: token.installation,
  activation: 'online' as const,
  token: text,
  seq: token.seq,
  issuedAt: token.issuedAt,
  refreshAfter: token.refreshAfter,
  notAfter: token.notAfter,
  nextAttemptAt: licenceRefreshAt(token.refreshAfter, env.random()),
});

/**
 * `arkvory license activate`: the key goes to the hub in the body of one request and is not kept.
 * The answer must carry this installation's id and this request's nonce; a token whose `seq` is
 * not above the kept one is refused before the secret is replaced.
 */
export async function activateLicence(
  env: LicenceEnvironment,
  input: { readonly key: string; readonly installation: string },
  signal?: LicenceSignal,
): Promise<LicenceExchangeResult> {
  const outcome = await env.store.exclusive(async () => {
    const nonce = env.nonce();
    const answer = await env.hub.activate(
      {
        key: input.key,
        installId: input.installation,
        nonce,
        coreVersion: env.coreVersion,
        modules: await env.modules(),
        requestedAt: licenceIso(await env.store.databaseNow()),
      },
      signal,
    );
    if (answer.kind === 'refused') return refused(answer.code);
    if (answer.kind === 'failed') return { outcome: 'failed', code: answer.failure } as const;
    if (answer.kind === 'revoked') return refused('answer_invalid');
    const token = verified(env, answer.token);
    if (typeof token === 'string') return refused(`answer_invalid:${token}`);
    if (token.activationId !== answer.activationId) return refused('answer_invalid');
    if (token.installation !== input.installation) return refused('installation_mismatch');
    if (token.nonce !== nonce) return refused('nonce_mismatch');
    const kept = await env.store.activation(token.activationId);
    if (kept !== null && token.seq <= kept.seq) return refused('seq_replayed', token.activationId);
    // The secret first: if the database write fails, the next refresh still authenticates.
    await env.secrets.write(token.activationId, {
      secret: answer.activationSecret,
      seq: token.seq,
    });
    if ((await env.store.saveToken(tokenRecord(env, token, answer.token))) === 'stale')
      return refused('seq_replayed', token.activationId);
    return {
      outcome: 'activated',
      activationId: token.activationId,
      licenceId: token.licenceId,
      seq: token.seq,
      notAfter: token.notAfter,
    } as const;
  }, LICENCE_LOCK_WAIT_MS);
  return outcome === 'busy' ? { outcome: 'busy' } : outcome;
}

async function exchange(
  env: LicenceEnvironment,
  body: LicenceRefreshBody,
  signal?: LicenceSignal,
): Promise<LicenceHubAnswer> {
  let answer = await env.hub.refresh(body, signal);
  // A lost answer may have retired the secret: only the same nonce and seq within the hub's
  // window take it again, so repeat at once instead of after the usual pause of 15 minutes.
  for (const delay of LOST_ANSWER_DELAYS_MS) {
    if (answer.kind !== 'failed' || !answer.sent || signal?.aborted) break;
    await env.sleep(delay, signal);
    answer = await env.hub.refresh(body, signal);
  }
  return answer;
}

async function failed(
  env: LicenceEnvironment,
  row: StoredActivation,
  code: string,
  retryAfterMs: number | null,
): Promise<LicenceExchangeResult> {
  const now = await effectiveNow(env.store);
  const nextAttemptAt = licenceRetryable(code)
    ? now + licenceRetryDelay(row.failures + 1, env.random(), retryAfterMs ?? 0)
    : null;
  await env.store.recordFailure(row.activationId, code, nextAttemptAt);
  return {
    outcome: licenceRetryable(code) ? 'failed' : 'refused',
    code,
    activationId: row.activationId,
    nextAttemptAt,
  };
}

async function accepted(
  env: LicenceEnvironment,
  row: StoredActivation,
  answer: Extract<LicenceHubAnswer, { kind: 'issued' }>,
  sent: { readonly nonce: string; readonly seq: number },
): Promise<LicenceExchangeResult> {
  const token = verified(env, answer.token);
  const valid =
    typeof token !== 'string' &&
    token.activationId === row.activationId &&
    answer.activationId === row.activationId &&
    token.nonce === sent.nonce &&
    token.licenceId === row.licenceId &&
    token.installation === row.installation &&
    token.seq > row.seq;
  // The answer came over verified TLS, so the hub has retired the secret that was sent: keep
  // the new one even when the document is refused, or the next refresh would look like a clone.
  await env.secrets.write(row.activationId, {
    secret: answer.activationSecret,
    seq: valid ? token.seq : sent.seq + 1,
  });
  if (!valid) return failed(env, row, 'answer_invalid', null);
  if ((await env.store.saveToken(tokenRecord(env, token, answer.token))) === 'stale')
    return failed(env, row, 'answer_invalid', null);
  return {
    outcome: 'refreshed',
    activationId: row.activationId,
    licenceId: token.licenceId,
    seq: token.seq,
    notAfter: token.notAfter,
  };
}

async function revoked(
  env: LicenceEnvironment,
  row: StoredActivation,
  text: string,
  nonce: string,
): Promise<LicenceExchangeResult> {
  let statement;
  try {
    statement = env.verifier.revocation(text);
  } catch (error) {
    if (error instanceof LicenceDocumentRefused) return failed(env, row, 'answer_invalid', null);
    throw error;
  }
  // Only a signed statement for this activation and request, above every kept token, revokes.
  if (
    statement.activationId !== row.activationId ||
    statement.licenceId !== row.licenceId ||
    statement.nonce !== nonce ||
    statement.seq <= row.seq ||
    (await env.store.saveRevocation(row.activationId, text, statement.seq, statement.issuedAt)) ===
      'stale'
  )
    return failed(env, row, 'answer_invalid', null);
  return {
    outcome: 'revoked',
    activationId: row.activationId,
    licenceId: row.licenceId,
    reason: statement.reason,
  };
}

async function refreshRow(
  env: LicenceEnvironment,
  row: StoredActivation,
  signal?: LicenceSignal,
): Promise<LicenceExchangeResult> {
  if (row.activation === 'offline') return refused('offline_activation', row.activationId);
  if (row.revocation !== null) return refused('license_revoked', row.activationId);
  const secret = await env.secrets.read(row.activationId);
  if (secret === null) return failed(env, row, 'secret_missing', null);
  const now = await env.store.databaseNow();
  // The nonce of an attempt for the same secret within the hub's window is sent again.
  const pending = row.pendingNonce;
  const nonce =
    pending !== null &&
    row.pendingSeq === secret.seq &&
    row.pendingSince !== null &&
    now - row.pendingSince < LICENCE_RETRY_WINDOW_MS
      ? pending
      : env.nonce();
  await env.store.startAttempt(row.activationId, nonce, secret.seq);
  const answer = await exchange(
    env,
    {
      activationId: row.activationId,
      activationSecret: secret.secret,
      nonce,
      seq: secret.seq,
      coreVersion: env.coreVersion,
      modules: await env.modules(),
    },
    signal,
  );
  switch (answer.kind) {
    case 'issued':
      return accepted(env, row, answer, { nonce, seq: secret.seq });
    case 'revoked':
      return revoked(env, row, answer.revocation, nonce);
    case 'refused':
      return failed(env, row, answer.code, answer.retryAfterMs);
    case 'failed':
      return failed(env, row, answer.failure, answer.retryAfterMs);
  }
}

/** `arkvory license refresh` and the scheduler: one activation, alone among exchanges. */
export async function refreshLicence(
  env: LicenceEnvironment,
  activationId: string,
  signal?: LicenceSignal,
  waitMs = LICENCE_LOCK_WAIT_MS,
): Promise<LicenceExchangeResult> {
  const outcome = await env.store.exclusive(async () => {
    const row = await env.store.activation(activationId);
    return row === null ? refused('activation_unknown') : refreshRow(env, row, signal);
  }, waitMs);
  return outcome === 'busy' ? { outcome: 'busy' } : outcome;
}

/**
 * `arkvory license deactivate`: gives the place back on the hub and deletes the secret. An
 * offline activation is removed locally; its place is the site's to free.
 */
export async function deactivateLicence(
  env: LicenceEnvironment,
  activationId: string,
  signal?: LicenceSignal,
): Promise<LicenceExchangeResult> {
  const outcome = await env.store.exclusive(async (): Promise<LicenceExchangeResult> => {
    const row = await env.store.activation(activationId);
    if (row === null) return refused('activation_unknown');
    const secret = row.activation === 'online' ? await env.secrets.read(activationId) : null;
    if (secret !== null) {
      const answer = await env.hub.deactivate(
        { activationId, activationSecret: secret.secret },
        signal,
      );
      if (answer.kind === 'refused') return refused(answer.code, activationId);
      if (answer.kind === 'failed')
        return { outcome: 'failed', code: answer.failure, activationId };
    }
    await env.secrets.remove(activationId);
    await env.store.remove(activationId);
    return { outcome: 'released', activationId };
  }, LICENCE_LOCK_WAIT_MS);
  return outcome === 'busy' ? { outcome: 'busy' } : outcome;
}

/**
 * One pass of the worker's scheduler: refreshes the online activations that are due. Without an
 * activation it asks nothing of the hub (ADR 0078, R2: the free core never contacts it).
 */
export async function refreshDueLicences(
  env: LicenceEnvironment,
  signal?: LicenceSignal,
): Promise<readonly LicenceExchangeResult[]> {
  const rows = await env.store.activations();
  if (rows.length === 0) return [];
  const now = await effectiveNow(env.store);
  const results: LicenceExchangeResult[] = [];
  for (const row of rows) {
    if (signal?.aborted) break;
    if (row.activation !== 'online' || row.revocation !== null) continue;
    if (row.nextAttemptAt === null || row.nextAttemptAt > now) continue;
    // The scheduler does not wait behind an operator's command: it tries again next pass.
    results.push(await refreshLicence(env, row.activationId, signal, 0));
  }
  return results;
}

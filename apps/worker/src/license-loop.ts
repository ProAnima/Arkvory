import { setTimeout as delay } from 'node:timers/promises';
import { refreshDueLicences, updateLicenceRevocations } from '@proanima/arkvory-application';
import type { LicenceEnvironment, LicenceExchangeResult } from '@proanima/arkvory-application';
import { failureCause, licenceEnvironment, licencePool } from '@proanima/arkvory-infrastructure';
import type { DiagnosticLogger, LicenceConfiguration } from '@proanima/arkvory-infrastructure';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface LicenceLoopOptions {
  /** The worker's database; the loop opens its own small pool on it. */
  readonly databaseUrl: string;
  /** Null without `ARKVORY_LICENSE_DIR`: the process has no licensing to do. */
  readonly configuration: LicenceConfiguration | null;
  readonly coreVersion: string;
  readonly stop: AbortSignal;
  readonly diagnostics: DiagnosticLogger;
  readonly intervalMs?: number;
  /** Tests replace the environment (another licence root, a stub hub). */
  readonly environment?: LicenceEnvironment;
  readonly now?: () => number;
}

function report(diagnostics: DiagnosticLogger, result: LicenceExchangeResult) {
  if (result.outcome === 'busy') return;
  const activation = 'activationId' in result ? result.activationId : undefined;
  const fields = { component: 'license', ...(activation ? { activation } : {}) } as const;
  if (result.outcome === 'refreshed')
    diagnostics.write({ level: 'info', ...fields, code: 'license.refreshed' });
  else if (result.outcome === 'revoked')
    diagnostics.write({
      level: 'warning',
      ...fields,
      code: 'license.revoked',
      reason: result.reason,
    });
  else if (result.outcome === 'failed' || result.outcome === 'refused')
    diagnostics.write({
      level: 'warning',
      ...fields,
      code: 'license.refresh_failed',
      errorCode: result.code,
    });
}

/**
 * The licence scheduler of the active worker (ADR 0078, R2): the only process of an installation
 * that talks to the hub about licences; the API, read gateways and other processes read the
 * state from the database. Without an activation a pass reads one table and asks the hub
 * nothing, so the free core never contacts it. A failure of the hub only slows this loop: the
 * worker's jobs, uploads, downloads, backups and restores never wait for it.
 */
export async function runLicences(options: LicenceLoopOptions): Promise<void> {
  const { configuration } = options;
  if (configuration === null) return;
  if (options.environment !== undefined) return loop(options, configuration, options.environment);
  const pool = licencePool(options.databaseUrl);
  try {
    await loop(
      options,
      configuration,
      licenceEnvironment(pool, configuration, options.coreVersion),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function loop(
  options: LicenceLoopOptions,
  configuration: LicenceConfiguration,
  env: LicenceEnvironment,
): Promise<void> {
  const { stop, diagnostics } = options;
  const now = options.now ?? (() => performance.now());
  let observed = Number.NEGATIVE_INFINITY;
  let listed = Number.NEGATIVE_INFINITY;
  while (!stop.aborted) {
    try {
      if ((await env.store.activations()).length > 0) {
        // The writer's clock mark and installation id: hourly, as ADR 0078, 6.4 asks.
        if (now() - observed >= HOUR) {
          await env.store.observe(configuration.installation);
          observed = now();
        }
        for (const result of await refreshDueLicences(env, stop)) report(diagnostics, result);
        if (now() - listed >= DAY) {
          listed = now();
          const list = await updateLicenceRevocations(env, stop);
          if (list?.outcome === 'refused')
            diagnostics.write({
              level: 'warning',
              component: 'license',
              code: 'license.revocations_refused',
              errorCode: list.code,
            });
        }
      }
    } catch (error) {
      if (options.stop.aborted) break;
      diagnostics.write({
        level: 'warning',
        component: 'license',
        code: 'license.step_failed',
        ...failureCause(error),
      });
    }
    await delay(options.intervalMs ?? 60_000, undefined, { signal: stop }).catch(() => undefined);
  }
}

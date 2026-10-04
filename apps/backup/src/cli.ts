import { BackupFailure } from '@proanima/arkvory-domain';
import type { BackupFailureCode } from '@proanima/arkvory-domain';
import { backupFailureOf } from '@proanima/arkvory-application';
import type { Cancellation } from '@proanima/arkvory-application';
import {
  DiagnosticLogger,
  failureCause,
  installCrashHandlers,
  parseLogLevel,
  processIdentity,
  readReleaseCommit,
  readReleaseVersion,
  redactDiagnostic,
  startEventLoopWatchdog,
  watchdogSeconds,
} from '@proanima/arkvory-infrastructure';
import type { EventLoopWatchdog, LogLevel } from '@proanima/arkvory-infrastructure';
import { exitCodeFor, parseArguments, usage } from './arguments.js';
import type { BackupCommand } from './arguments.js';
import { runCapture } from './capture-command.js';
import { runRestore } from './restore-command.js';
import { runList, runVaultInit, runVerify } from './vault-commands.js';
import type { CliContext } from './context.js';
import { runAgent } from './agent.js';
import { agentConfig } from './config.js';

function watchdogSetting(value: string | undefined): number {
  try {
    return watchdogSeconds(value);
  } catch {
    throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_WATCHDOG_SECONDS');
  }
}

const hints: Partial<Record<BackupFailureCode, string>> = {
  vault_missing:
    'The directory has no vault.json. Run "vault init" once, or mount the vault volume first.',
  unsafe_path: 'Keep the vault, the storage root and restore targets in separate directory trees.',
  target_not_empty: 'Restore writes only into an empty database and an empty storage directory.',
  schema_mismatch: 'Run migrate on the source, or restore with a release of the backup schema.',
  upgrade_required: 'Upgrade every API and maintenance process before the first capture.',
  busy: 'Another capture or offline maintenance is running; retry later.',
  barrier_timeout: 'A running cleanup did not finish its unlink in time; retry later.',
  integrity_mismatch: 'Vault data failed verification. Keep the vault unchanged and investigate.',
  invalid_manifest: 'A vault document is invalid. Keep the vault unchanged and investigate.',
  blob_missing: 'Content is missing. Run verify --deep and keep the vault unchanged.',
  vault_full: 'The vault volume is full; earlier points are intact. Free space and retry.',
  attempts_exhausted: 'This idempotency key has no attempts left; use a new key.',
};

function level(env: NodeJS.ProcessEnv): { level: LogLevel; invalid: boolean } {
  try {
    return { level: parseLogLevel(env['ARKVORY_LOG_LEVEL']), invalid: false };
  } catch {
    return { level: 'info', invalid: true };
  }
}

async function runAgentCommand(context: CliContext): Promise<number> {
  await runAgent({
    config: agentConfig(context.env),
    release: context.release,
    logger: context.logger,
    signal: context.signal,
  });
  return 0;
}

function dispatch(command: Exclude<BackupCommand, { kind: 'help' }>, context: CliContext) {
  switch (command.kind) {
    case 'agent':
      return runAgentCommand(context);
    case 'vault-init':
      return runVaultInit(command, context);
    case 'capture':
      return runCapture(command, context);
    case 'list':
      return runList(command, context);
    case 'verify':
      return runVerify(command, context);
    case 'restore':
      return runRestore(command, context);
  }
}

/** Operator CLI: JSON lines on stdout, one hint line on stderr on failure, documented exits. */
export async function runBackupCli(argv: readonly string[], env: NodeJS.ProcessEnv) {
  const configured = level(env);
  // releases/<version>/apps/backup/dist/cli.js -> releases/<version>/release.json
  const manifest = new URL('../../../release.json', import.meta.url);
  const release = {
    version: await readReleaseVersion(manifest),
    commit: await readReleaseCommit(manifest),
  };
  const logger = new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
    level: configured.level,
    process: processIdentity('backup', release.version),
  });
  const uninstall = installCrashHandlers(logger);
  let watchdog: EventLoopWatchdog | undefined;
  const stop = new AbortController();
  const signal = () => {
    stop.abort();
  };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  const cancellation: Cancellation = {
    throwIfAborted() {
      if (stop.signal.aborted) throw new BackupFailure('interrupted', 'Stopped by a signal');
    },
  };
  try {
    if (configured.invalid)
      throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_LOG_LEVEL');
    watchdog = startEventLoopWatchdog({
      seconds: watchdogSetting(env['ARKVORY_WATCHDOG_SECONDS']),
      fields: processIdentity('backup', release.version),
      onError: (error) => {
        logger.write({
          level: 'warning',
          component: 'backup',
          code: 'process.watchdog_failed',
          ...failureCause(error),
        });
      },
    });
    const command = parseArguments(argv);
    if (command.kind === 'help') {
      process.stdout.write(usage + '\n');
      return 0;
    }
    return await dispatch(command, { logger, env, cancellation, release, signal: stop.signal });
  } catch (error) {
    const failure = backupFailureOf(error);
    // Messages are constant texts of this code base; causes contribute identifiers only.
    logger.write({
      level: 'error',
      component: 'backup',
      code: 'backup.failed',
      errorCode: failure.code,
      reason: redactDiagnostic(failure.message),
      ...failureCause(failure.cause ?? failure),
    });
    const hint =
      failure.code === 'invalid_argument'
        ? usage
        : (hints[failure.code] ?? 'Backup command failed; the JSON line names the errorCode.');
    process.stderr.write(hint + '\n');
    return exitCodeFor(failure.code);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    watchdog?.stop();
    uninstall();
    await logger.flush();
  }
}

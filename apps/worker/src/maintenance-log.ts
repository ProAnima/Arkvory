import {
  DiagnosticLogger,
  failureCause,
  installCrashHandlers,
  processIdentity,
  readReleaseVersion,
  startupReason,
} from '@proanima/arkvory-infrastructure';

/** Logger for one offline maintenance command (gc, scrub) with the release identity. */
export async function maintenanceLogger(service: 'gc' | 'scrub'): Promise<DiagnosticLogger> {
  const logger = new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
    process: processIdentity(
      service,
      // releases/<version>/apps/worker/dist/<command>.js -> releases/<version>/release.json
      await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
    ),
  });
  installCrashHandlers(logger);
  return logger;
}

/** Structured failure on stdout plus the operator hint on stderr; exit code 1. */
export function maintenanceFailed(
  logger: DiagnosticLogger,
  code: string,
  error: unknown,
  hint: string,
): void {
  logger.write({
    level: 'error',
    component: 'maintenance',
    code,
    reason: startupReason(error),
    ...failureCause(error),
  });
  process.stderr.write(hint + '\n');
  process.exitCode = 1;
}

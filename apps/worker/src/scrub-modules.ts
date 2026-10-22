import { allowResolutionUnder, resolutionConfined } from '@proanima/arkvory-resolution';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  installedModulesFrom,
  loadInstallation,
  ModuleStorages,
  PostgresModulePlan,
  PostgresStorageIdentities,
  probeStorageBackends,
  processModules,
  readModuleSelections,
  readReleaseVersion,
  storageReserveBytes,
  storageReserveInodes,
} from '@proanima/arkvory-infrastructure';
import type { DiagnosticRecord, HostedModuleContext } from '@proanima/arkvory-infrastructure';
import type { resources } from './runtime.js';

/** Scrub already owns maintenance exclusion. Bind storage with backup's read-only
 * role: no module writer, GC, licence refresh or feed may run during verification. */
export async function scrubModules(
  acquired: Awaited<ReturnType<typeof resources>>,
  diagnostics: { write(record: DiagnosticRecord): void },
) {
  const installed = installedModulesFrom(process.env);
  const installation = await loadInstallation<HostedModuleContext>({
    role: 'backup',
    coreVersion: await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
    selections: await readModuleSelections(process.env['ARKVORY_MODULES_FILE']),
    installed,
    now: Date.now(),
    admit: (directory) => {
      if (resolutionConfined()) allowResolutionUnder(directory);
    },
  });
  const host = processModules(
    'backup',
    installation,
    {
      dataDirectory: acquired.dataDirectory,
      dataPool: acquired.catalog.sessions,
      reserve: {
        bytes: storageReserveBytes(process.env['ARKVORY_STORAGE_RESERVE_BYTES']),
        inodes: storageReserveInodes(process.env['ARKVORY_STORAGE_RESERVE_INODES']),
      },
      readOnly: true,
      storage: new ModuleStorages(acquired.blobs, true),
      catalog: () => {
        throw new Error('Scrub does not expose catalog service');
      },
      compute: (id) => installation.prepared.get(id)?.compute?.(),
    },
    diagnostics,
  );
  try {
    const recorded = await new PostgresModulePlan(acquired.catalog.pool).read();
    if (
      installed &&
      recorded?.compatibilityFingerprint !== installation.plan.compatibilityFingerprint
    )
      throw new ArkvoryError('busy', 'Scrub module plan differs from the writer');
    await host.runtime.start();
    if (host.runtime.blockingFailure())
      throw new ArkvoryError('unavailable', 'Scrub module failed');
    await probeStorageBackends(
      acquired.blobs,
      new PostgresStorageIdentities(acquired.catalog.pool),
      { create: false },
    );
    return host;
  } catch (error) {
    await host.close();
    throw error;
  }
}

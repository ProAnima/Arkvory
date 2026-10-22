import { ArkvoryError } from '@proanima/arkvory-domain';
import { allowResolutionUnder, resolutionConfined } from '@proanima/arkvory-resolution';
import type { StorageBackendStates } from '@proanima/arkvory-application';
import {
  installedModulesFrom,
  loadInstallation,
  PostgresModulePlan,
  PostgresStorageIdentities,
  readModuleSelections,
  readReleaseVersion,
} from '@proanima/arkvory-infrastructure';
import type { PostgresCatalog } from '@proanima/arkvory-infrastructure';

/** Planning does not open module storage or acquire ownership. Only recorded instances
 * of verified, enabled modules in the writer's plan are admitted as unopened here.
 * The real worker still checks identity, mode and licence before every copy. */
export async function rehomeStorages(
  catalog: PostgresCatalog,
  local: StorageBackendStates,
): Promise<StorageBackendStates> {
  const installed = installedModulesFrom(process.env);
  if (!installed) return local;
  // Reader verifies the installed plan without importing worker-only code for planning.
  const installation = await loadInstallation({
    role: 'reader',
    coreVersion: await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
    selections: await readModuleSelections(process.env['ARKVORY_MODULES_FILE']),
    installed,
    now: Date.now(),
    admit: (directory) => {
      if (resolutionConfined()) allowResolutionUnder(directory);
    },
  });
  const recorded = await new PostgresModulePlan(catalog.pool).read();
  if (recorded?.compatibilityFingerprint !== installation.plan.compatibilityFingerprint)
    throw new ArkvoryError('busy', 'Rehome module plan differs from the writer');
  const modules = new Set(
    installation.plan.modules
      .filter((m) => m.enabled && m.source === 'signed' && m.manifest.kind === 'storage-backend')
      .map((m) => m.manifest.id),
  );
  const known = (await new PostgresStorageIdentities(catalog.pool).known()).filter((id) =>
    modules.has(id.slice(0, id.lastIndexOf('.'))),
  );
  const ids = new Set(known);
  return {
    ids: () => [...new Set([...local.ids(), ...known])],
    state: (id) => (ids.has(id) ? 'unavailable' : local.state(id)),
  };
}

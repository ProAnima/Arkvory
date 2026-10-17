import type { ModulePlanProblem, ModuleRole } from '@proanima/arkvory-extension-api';
import { revocationOf } from '@proanima/arkvory-signing';
import type {
  InstalledModule,
  PackageManifest,
  RevocationList,
  SignedManifest,
} from '@proanima/arkvory-signing';

/**
 * How a refused module shows in `system/modules`: `revoked` by an entry of the revocation list,
 * `unavailable` when its package is missing from the host (ADR 0078, I1 table), `failed` for
 * every other refusal.
 */
export type RefusalStatus = 'failed' | 'revoked' | 'unavailable';

/**
 * An installed module the loader does not plan. Kind and roles are known only once the
 * signature verified; before that the refusal names the installed id and version only.
 */
export interface RefusedModule {
  readonly id: string;
  readonly version: string;
  readonly kind: string | null;
  readonly roles: readonly ModuleRole[];
  /** Whether the operator enabled it in ARKVORY_MODULES_FILE; set when it is planned. */
  readonly enabled: boolean;
  readonly status: RefusalStatus;
  /** Machine code: a signing, access, plan or loader code, or the revocation reason. */
  readonly code: string;
}

/** A package that passed every check before code: the access check, the signature and files. */
export interface VerifiedModule {
  readonly entry: InstalledModule;
  readonly directory: string;
  readonly manifest: PackageManifest;
}

/**
 * Processes that host signed modules in this release: the writer and read gateways. The worker
 * and the backup agent plan every installed module, so their fingerprint matches the writer's,
 * but run none yet: a module with their role is refused everywhere (`role_unsupported`) rather
 * than planned and silently not run there.
 */
export const HOSTED_ROLES: readonly ModuleRole[] = ['api', 'reader'];

/**
 * The decision for a package whose signature and files verified (ADR 0078, 3.3 and 3.4), in this
 * order: it must be the package the host tool installed (same id, version, signing key and data
 * class, a ProAnimaStudio key), no entry of the stored revocation list may name its version,
 * every role must be hosted and it may not declare routes yet. A revoked version is never loaded, whatever its `readOnly`: no point of
 * this release reads module data yet, so the read-only path has nothing to serve (ADR 0078, O5).
 */
export function admitPackage(
  entry: InstalledModule,
  signed: SignedManifest,
  list: RevocationList | null,
  directory: string,
): VerifiedModule | RefusedModule {
  const { module } = signed.manifest;
  const refused = (status: RefusalStatus, code: string): RefusedModule => ({
    id: entry.id,
    version: entry.version,
    kind: module.kind,
    roles: module.roles,
    enabled: false,
    status,
    code,
  });
  if (
    signed.signer.source !== 'signed' ||
    module.id !== entry.id ||
    module.version !== entry.version ||
    signed.signer.keyId !== entry.keyId ||
    signed.manifest.package.dataClass !== entry.dataClass
  )
    return refused('failed', 'installed_mismatch');
  const revoked = revocationOf(list, module.id, module.version);
  if (revoked !== null) return refused('revoked', revoked.reason);
  if (module.roles.some((role) => !HOSTED_ROLES.includes(role)))
    return refused('failed', 'role_unsupported');
  // Routes of signed modules under /api/ext/ come with ModuleRoute (ADR 0079, X5); a prefix
  // without routes would stop the contract guard of every process.
  if (module.routePrefixes.length > 0) return refused('failed', 'routes_unsupported');
  return { entry, directory, manifest: signed.manifest };
}

/**
 * The plan problems that name a signed module, each module once with its first code. The loader
 * refuses those modules and plans again; a problem of a built-in module is the operator's
 * configuration and still stops the start (`ModulePlanError`).
 */
export function signedRefusals(
  problems: readonly ModulePlanProblem[],
  signed: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const problem of problems)
    if (problem.module !== null && signed.has(problem.module) && !found.has(problem.module))
      found.set(problem.module, problem.code);
  return found;
}

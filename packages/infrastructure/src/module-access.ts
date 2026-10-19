/**
 * The access check of module directories (ADR 0078, 3.3) lives in `packages/signing`, beside
 * the package verification it guards: the server loader and `arkvoryctl` (ADR 0079, 5.11)
 * classify owners and access rules by the same code.
 */
export {
  ModuleAccessError,
  aclProblem,
  packageTree,
  unsafeAcl,
  unsafeEntries,
} from '@proanima/arkvory-signing';
export type { AclEntry, ModuleAccessProblem } from '@proanima/arkvory-signing';

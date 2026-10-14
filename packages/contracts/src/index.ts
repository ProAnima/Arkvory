// Architecture scaffold. Public exports are added with the first use case.
export * from './native.js';
export * from './responses.js';
export * from './assets.js';
export * from './artifact-search.js';
export * from './health.js';
export * from './identity.js';
export * from './security-audit.js';
export * from './service-api.js';
export * from './delegation-api.js';
export * from './repositories.js';
export { apiMethods, assertRouteInventory } from './openapi-compose.js';
export type { ApiOperation, RuntimeRoute } from './openapi-compose.js';
export type { ApiMethod, OperationPolicy } from './operation-policy.js';
export * from './operations.js';
export { apiSurfaces, apiVisibilities } from './api-surfaces.js';
export type { ApiSurface, ApiVisibility } from './api-surfaces.js';

export * from './attachments.js';

export * from './retention.js';

export * from './storage-policy.js';
export * from './cleanup.js';
export * from './updates.js';
export * from './backup-wire.js';
export * from './mirror-api.js';
export * from './fleet.js';
export {
  fleetChangeMethod,
  fleetChangeRoutes,
  fleetReadRoutes,
  isFleetReadPath,
  type FleetChangeMethod,
} from './fleet-read.js';
export { fleetOperations, topologySchema } from './fleet-api.js';
export * from './feedback-api.js';
export * from './download-link-api.js';
export * from './raw-api.js';
export {
  backupOperations,
  backupPlanSchema,
  backupPointSchema,
  backupJobSchema,
} from './backup-api.js';
export * from './promotions.js';
export { promotionOperations, resolvedPackageSchema } from './promotion-api.js';
export {
  errorCodes,
  errorReasons,
  detailProblems,
  maxErrorDetails,
  nativeErrorSchema,
  readNativeError,
} from './errors.js';
export type {
  ErrorCodeName,
  ErrorReasonName,
  ErrorDetailResponse,
  NativeErrorResponse,
} from './errors.js';
export {
  downloadSettingsOperations,
  readDownloadSettings,
  type DownloadOverrides as DownloadSettingOverrides,
  type DownloadSettingValues,
  type DownloadSettings,
  type DownloadSettingsChange,
} from './download-settings-api.js';
export {
  isSourceKey,
  readSiteChange,
  readSiteChangeRequest,
  readSiteChangeStatus,
  siteChangeKinds,
  SITE_CHANGE_TTL_MS,
  type SiteChange,
  type SiteChangeKind,
  type SiteChangeRecord,
  type SiteChangeRequest,
  type SiteChangeState,
  type SiteChangeStatus,
} from './site-changes.js';

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
export * from './promotions.js';
export { promotionOperations, resolvedPackageSchema } from './promotion-api.js';

export {
  EXTENSION_API_VERSION,
  parseCaretRange,
  parseSemanticVersion,
  satisfiesCaret,
  type SemanticVersion,
} from './version.js';
export { canonicalJson, type ModuleJson } from './json.js';
export {
  MODULE_ID_PATTERN,
  MODULE_KINDS,
  MODULE_MANIFEST_FORMAT,
  MODULE_ROLES,
  ModuleManifestError,
  parseModuleManifest,
  type ModuleKind,
  type ModuleManifest,
  type ModuleManifestProblem,
  type ModuleResources,
  type ModuleRole,
} from './manifest.js';
export {
  CAPABILITY_NAME,
  capabilityName,
  defineCapability,
  parseProvidedCapability,
  parseRequiredCapability,
  type CapabilityEntry,
  type CapabilityToken,
  type ModuleCapabilities,
} from './capabilities.js';
export {
  ModuleServiceError,
  SERVICE_ERROR_CODES,
  type BlobDescriptor,
  type ByteRange,
  type Page,
  type PageRequest,
  type PartRef,
  type ServiceErrorCode,
} from './portable.js';
export type { HostServices, HostServiceTypes } from './services.js';
export type { StagedCompletion, StagedObject } from './staged.js';
export type {
  AccessScope,
  ArtifactView,
  AssetView,
  BatchView,
  CatalogRead,
  ContentHandle,
  ContentRead,
  ContentRef,
  PackageQuery,
  PackageView,
  SearchHit,
  SearchQuery,
} from './catalog-read.js';
export type {
  FileSink,
  ModuleDataDirectory,
  ModuleDataUsage,
  ModuleFiles,
} from './module-files.js';
export { MODULE_SOURCES, type ModuleSource } from './sources.js';
export {
  HOST_SERVICES,
  type HostService,
  type ModuleContext,
  type ModuleCounter,
  type ModuleGauge,
  type ModuleLog,
  type ModuleLogLevel,
  type ModuleLogRecord,
  type ModuleMetrics,
  type ModuleMode,
} from './context.js';
export {
  ModuleConfigError,
  type ModuleConfigProblem,
  type ModuleDescriptor,
  type ModuleHealth,
  type ModuleHealthStatus,
  type ModuleLifecycle,
  type ModuleSignal,
} from './descriptor.js';
export {
  planModules,
  type ModuleCandidate,
  type ModuleHost,
  type ModulePlan,
  type ModulePlanProblem,
  type ModulePlanProblemCode,
  type ModulePlanResult,
  type PlannedModule,
} from './plan.js';
export type { ModulePlanRuleCode } from './plan-rules.js';
export {
  MODULE_JSON_BODY_LIMIT,
  MODULE_JSON_RESPONSE_LIMIT,
  MODULE_ROUTE_ACTIONS,
  MODULE_ROUTE_ERRORS,
  MODULE_ROUTE_LIMIT,
  MODULE_ROUTE_METHODS,
  MODULE_ROUTE_TIMEOUT_LIMIT_MS,
  type ModuleRequest,
  type ModuleRequestBody,
  type ModuleResponse,
  type ModuleRoute,
  type ModuleRouteAction,
  type ModuleRouteBody,
  type ModuleRouteError,
  type ModuleRouteMethod,
  type ModuleRoutes,
  type ModuleTransferOffer,
} from './routes.js';

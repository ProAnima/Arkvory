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
  type ModuleRole,
} from './manifest.js';
export {
  HOST_SERVICES,
  MODULE_SOURCES,
  type HostService,
  type ModuleContext,
  type ModuleCounter,
  type ModuleGauge,
  type ModuleLog,
  type ModuleLogLevel,
  type ModuleLogRecord,
  type ModuleMetrics,
  type ModuleMode,
  type ModuleSource,
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
  LICENSE_STATES,
  type LicenseEvidence,
  type LicenseService,
  type LicenseState,
  type LicenseView,
} from './license.js';

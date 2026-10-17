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
  type ModuleSource,
  type PlannedModule,
} from './plan.js';

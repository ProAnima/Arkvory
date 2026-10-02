// Composition used by the CLI; exported for argument and acceptance tests only.
export { parseArguments, exitCodeFor, usage } from './arguments.js';
export type { BackupCommand } from './arguments.js';
export { sourceConfig } from './config.js';
export type { SourceConfig } from './config.js';
export { openCaptureSource, openVault, captureDependencies } from './source.js';
export type { CaptureSource } from './source.js';

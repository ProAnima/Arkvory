// Composition used by the CLI; exported for argument and acceptance tests only.
export { parseArguments, exitCodeFor, usage } from './arguments.js';
export type { BackupCommand } from './arguments.js';
export { sourceConfig, agentConfig } from './config.js';
export type { SourceConfig, AgentConfig } from './config.js';
export { runAgent } from './agent.js';
export type { AgentOptions } from './agent.js';
export { openCaptureSource, openVault, captureDependencies } from './source.js';
export type { CaptureSource } from './source.js';

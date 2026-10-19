import type { ModuleCapabilities } from './capabilities.js';
import type { ModuleSignal } from './descriptor.js';
import type { ModuleRole } from './manifest.js';
import type { ModuleSource } from './sources.js';

/**
 * Services of the core a module may declare in `uses` (ADR 0083, section 2.4). A module receives
 * in `context.services` only the services it declared; a host provides only those it implements.
 */
export const HOST_SERVICES = [
  'blob-store',
  'staged-completion',
  'catalog-read',
  'content-read',
  'upload-read',
  'change-feed',
  'data-directory',
  'routes',
  'compute',
  'license',
] as const;
export type HostService = (typeof HOST_SERVICES)[number];

/**
 * How the process serves data: a writer in `full`, a read gateway in `read-only`, a restore in
 * `restore`. A module refuses writes outside `full` with the code `read_only`.
 */
export type ModuleMode = 'full' | 'read-only' | 'restore';

export type ModuleLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** One line of a module's log. Only machine codes, identifiers and numbers: never a secret. */
export interface ModuleLogRecord {
  /** Machine code of the event, `[a-z][a-z0-9_.]{0,63}`; the core prefixes it with the module. */
  readonly code: string;
  /** The identifier the event concerns, such as a repository; never a URL, path or secret. */
  readonly subject?: string;
  readonly durationMs?: number;
  readonly count?: number;
}

/**
 * The module's diagnostic log. The core drops records below its level, refuses malformed codes
 * and limits how often one module writes; dropped records are counted, never queued.
 */
export interface ModuleLog {
  write(level: ModuleLogLevel, record: ModuleLogRecord): void;
}

export interface ModuleCounter {
  /** Adds a finite non-negative amount, 1 by default. */
  add(amount?: number): void;
}

export interface ModuleGauge {
  set(value: number): void;
}

/**
 * Metrics of the module. Every name starts with the module's `metricPrefix`; a module without
 * one, a foreign name or a name registered twice is refused with a `TypeError`.
 */
export interface ModuleMetrics {
  counter(name: string, help: string): ModuleCounter;
  gauge(name: string, help: string): ModuleGauge;
}

/** What the core passes to `create` (ADR 0083, section 2.4). */
export interface ModuleContext<Services> {
  readonly role: ModuleRole;
  readonly source: ModuleSource;
  readonly mode: ModuleMode;
  /** Aborts when the process stops. */
  readonly signal: ModuleSignal;
  readonly log: ModuleLog;
  readonly metrics: ModuleMetrics;
  /** Only the services the manifest declared in `uses`. */
  readonly services: Services;
  /** Values of the capabilities the manifest declared in `requires` and `optional`. */
  readonly capabilities: ModuleCapabilities;
}

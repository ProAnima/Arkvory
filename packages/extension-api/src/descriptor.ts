import type { ModuleJson } from './json.js';
import type { ModuleManifest } from './manifest.js';

/**
 * The part of an `AbortSignal` a module may use; this contract has no DOM or Node globals, and
 * the core passes a real `AbortSignal`.
 */
export interface ModuleSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type ModuleHealthStatus = 'ok' | 'degraded' | 'failed';

export interface ModuleHealth {
  readonly status: ModuleHealthStatus;
  /** Machine code of the reason (`[a-z][a-z0-9_]{0,63}`), null when `ok`. */
  readonly code: string | null;
}

/**
 * What the core calls on a created module, in this order: `start` once, `health` at any time
 * after it, `drain` once on shutdown, then `stop`.
 */
export interface ModuleLifecycle {
  /**
   * Acquires the module's resources. The signal aborts when the process stops while starting;
   * the module then gives up and rejects. A rejection stops the process start.
   */
  start(signal: ModuleSignal): Promise<void>;
  /** Stops taking new work and finishes accepted work within `budgetMs` milliseconds. */
  drain(budgetMs: number): Promise<void>;
  /**
   * Releases every resource. Idempotent; also called after a failed or aborted `start`, so it
   * must tolerate resources that were never acquired.
   */
  stop(): Promise<void>;
  /** Current state without I/O; must not throw. */
  health(): ModuleHealth;
}

/**
 * A module as the core sees it. `parseConfig` and `create` do no network or disk I/O: the core
 * parses and plans every module before starting any.
 */
export interface ModuleDescriptor<
  Context,
  Config,
  Instance extends ModuleLifecycle = ModuleLifecycle,
> {
  readonly manifest: ModuleManifest;
  /** Reads the module's configuration from untrusted input; throws `ModuleConfigError`. */
  parseConfig(input: unknown): Config;
  /**
   * The configuration as it enters the plan fingerprint: normalized, without secrets or paths
   * to secrets, so that equal settings give an equal fingerprint on every process.
   */
  describeConfig(config: Config): ModuleJson;
  /** Builds the instance from the dependencies the module declared; nothing else is passed. */
  create(context: Context, config: Config): Instance;
}

export type ModuleConfigProblem =
  'required' | 'unknown_field' | 'type' | 'format' | 'length' | 'range' | 'invalid';

/** A configuration a module cannot use. The message names the field, never the value. */
export class ModuleConfigError extends Error {
  override readonly name = 'ModuleConfigError';
  constructor(
    readonly code: ModuleConfigProblem,
    /** JSON Pointer of the field in the module's configuration; empty for the whole of it. */
    readonly path: string,
  ) {
    super(`Invalid module configuration: ${code} at ${path === '' ? '/' : path}`);
  }
}

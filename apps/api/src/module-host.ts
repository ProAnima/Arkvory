import type {
  ModuleHealth,
  ModuleLifecycle,
  ModulePlan,
  ModuleRole,
  ModuleSignal,
  PlannedModule,
} from '@proanima/arkvory-extension-api';
import { ModuleLoadError } from '@proanima/arkvory-infrastructure';
import type { PreparedModule, RefusedModule } from '@proanima/arkvory-infrastructure';

export interface ModuleState {
  readonly module: PlannedModule;
  /** Whether this process runs the module: enabled and one of its roles. */
  readonly running: boolean;
  /**
   * Health of a running module, or `failed` with the reason of a signed module that should run
   * here but could not be loaded or started; null when it does not belong to this process.
   */
  readonly health: ModuleHealth | null;
}

/** How long one signed module may take to start before it is stopped and reported failed. */
export const SIGNED_START_BUDGET_MS = 30_000;

class StartTimeout extends Error {}

/** `work`, or a `StartTimeout` after `budgetMs`; the timer never outlives the race. */
async function within<T>(work: Promise<T>, budgetMs: number, expired: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired();
      reject(new StartTimeout());
    }, budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Running {
  readonly id: string;
  readonly instance: ModuleLifecycle;
}

const HEALTH_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const HEALTH_STATUSES = ['ok', 'degraded', 'failed'] as const;

/**
 * A module's own report, or `failed` when it throws or answers outside the contract. The report
 * is read as unknown: module code is checked by review and tests, not trusted by its types.
 */
function healthOf(instance: ModuleLifecycle): ModuleHealth {
  try {
    const report: unknown = instance.health();
    if (typeof report !== 'object' || report === null)
      return { status: 'failed', code: 'health_invalid' };
    // An asynchronous health() breaks the contract; its rejection must not end the process.
    if (report instanceof Promise) report.catch(() => undefined);
    const value: unknown = Reflect.get(report, 'status');
    const code: unknown = Reflect.get(report, 'code');
    const status = HEALTH_STATUSES.find((known) => known === value);
    if (status && (code === null || (typeof code === 'string' && HEALTH_CODE.test(code))))
      return { status, code };
    return { status: 'failed', code: 'health_invalid' };
  } catch {
    return { status: 'failed', code: 'health_unavailable' };
  }
}

/** Waits for a drain at most `budgetMs`; a module that overruns is then stopped regardless. */
async function bounded(work: Promise<void>, budgetMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  try {
    await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stops in the given order; every module is stopped even when an earlier one fails. */
async function stopAll(running: readonly Running[]): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const { instance } of running)
    try {
      await instance.stop();
    } catch (error) {
      failures.push(error);
    }
  return failures;
}

/** The process this runtime runs in and what its modules receive. */
export interface ModuleProcess<Context> {
  readonly role: ModuleRole;
  /** The context of one module, built right before its `create`; `signal` is the process stop. */
  context(module: PlannedModule, signal: ModuleSignal): Context;
}

/**
 * The modules of one process (ADR 0079, section 4). Owns their instances: started once in plan
 * order, drained with one shared budget and stopped in reverse order exactly once. The plan is
 * known from construction, so settings and plan problems stop a process before it touches
 * storage; `start` is the only step with I/O.
 */
export class ModuleRuntime<Context = unknown> {
  private readonly running: Running[] = [];
  /** Signed modules of this process that could not be loaded, created or started: their code. */
  private readonly failed = new Map<string, string>();
  private readonly cancel = new AbortController();
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    readonly plan: ModulePlan,
    private readonly prepared: ReadonlyMap<string, PreparedModule<Context>>,
    private readonly process: ModuleProcess<Context>,
    /** Installed signed modules the loader refused before planning (ADR 0079, X4). */
    readonly refused: readonly RefusedModule[] = [],
    private readonly startBudgetMs = SIGNED_START_BUDGET_MS,
  ) {}

  /**
   * Creates and starts every enabled module of the process role in plan order, once. When a
   * start fails or is cancelled, the modules created so far, the failed one included, are
   * stopped in reverse order and the error is rethrown, with the failures of those stops if any.
   */
  start(): Promise<void> {
    if (this.starting || this.closing) return Promise.reject(new Error('Modules start once'));
    this.starting = this.startAll();
    return this.starting;
  }

  private async startAll(): Promise<void> {
    const signal = this.cancel.signal;
    try {
      for (const id of this.plan.startOrder) {
        const planned = this.plan.modules.find((m) => m.manifest.id === id);
        if (!planned?.manifest.roles.includes(this.process.role)) continue;
        const module = this.prepared.get(id);
        if (!module) throw new Error('Planned module was not prepared');
        signal.throwIfAborted();
        if (planned.source === 'builtin') await this.startBuiltin(id, planned, module, signal);
        else await this.startSigned(id, planned, module, signal);
      }
      // A module that ignored the cancellation must not leave a stopping process running it.
      signal.throwIfAborted();
    } catch (error) {
      const failures = await stopAll(this.running.splice(0).reverse());
      if (failures.length === 0) throw error;
      throw new AggregateError([error, ...failures], 'Module start failed', { cause: error });
    }
  }

  /** A built-in module: any failure stops the process start, as it always did. */
  private async startBuiltin(
    id: string,
    planned: PlannedModule,
    module: PreparedModule<Context>,
    signal: AbortSignal,
  ): Promise<void> {
    const instance = module.create(this.process.context(planned, signal));
    // Recorded before start: stop() also runs after a failed or cancelled start.
    this.running.push({ id, instance });
    await instance.start(signal);
  }

  /**
   * A signed module fails alone (ADR 0079, X4): code that did not load, a `create` or `start`
   * that throws, or a start beyond `startBudgetMs` marks it failed, stops what was created and
   * lets the next module start. A module that requires a capability of a failed one is not
   * created (`requirement_failed`). Only the cancellation of the process start is rethrown.
   */
  private async startSigned(
    id: string,
    planned: PlannedModule,
    module: PreparedModule<Context>,
    signal: AbortSignal,
  ): Promise<void> {
    const unavailable = new Set(
      this.plan.modules
        .filter((m) => this.failed.has(m.manifest.id))
        .flatMap((m) => m.manifest.provides),
    );
    if (planned.manifest.requires.some((capability) => unavailable.has(capability))) {
      this.failed.set(id, 'requirement_failed');
      return;
    }
    let instance: ModuleLifecycle;
    try {
      instance = module.create(this.process.context(planned, signal));
    } catch (error) {
      this.failed.set(id, error instanceof ModuleLoadError ? error.code : 'create_failed');
      return;
    }
    const own = new AbortController();
    const started = { id, instance };
    this.running.push(started);
    try {
      const start = instance.start(AbortSignal.any([signal, own.signal]));
      await within(start, this.startBudgetMs, () => {
        own.abort();
      });
    } catch (error) {
      if (signal.aborted) throw error;
      this.running.splice(this.running.indexOf(started), 1);
      await Promise.resolve()
        .then(() => instance.stop())
        .catch(() => undefined);
      this.failed.set(id, error instanceof StartTimeout ? 'start_timeout' : 'start_failed');
    }
  }

  /** Cancels a start in progress; modules already started run until `shutdown`. */
  cancelStart(): void {
    this.cancel.abort();
  }

  /** Enabled modules of this process's role, in id order: what it runs once started. */
  planned(): PlannedModule[] {
    return this.plan.modules.filter(
      (m) => m.enabled && m.manifest.roles.includes(this.process.role),
    );
  }

  /**
   * A module whose failure takes the process out of readiness (ADR 0079, section 4): a core
   * module, or one providing a capability that an enabled module requires, that failed while
   * running or, if signed, could not be loaded or started here; or an enabled signed module
   * refused before planning because a module it requires is missing. Other modules may fail or
   * degrade while the process stays ready; metrics and `system/modules` show them. A module that
   * stores published bytes (`dataClass: layout`) never takes the process out: the core keeps
   * serving its own data and new uploads go to the core's storage (ADR 0078, I1 and L4).
   */
  blockingFailure(): string | null {
    const required = new Set(
      this.plan.modules.filter((m) => m.enabled).flatMap((m) => m.manifest.requires),
    );
    const failed = this.states().find(
      ({ module, health }) =>
        health?.status === 'failed' &&
        this.prepared.get(module.manifest.id)?.dataClass !== 'layout' &&
        (module.manifest.core || module.manifest.provides.some((c) => required.has(c))),
    );
    const consumer = this.refused.find((m) => m.enabled && m.code === 'missing_requirement');
    return failed?.module.manifest.id ?? consumer?.id ?? null;
  }

  states(): ModuleState[] {
    return this.plan.modules.map((module) => {
      const id = module.manifest.id;
      const instance = this.running.find((r) => r.id === id)?.instance;
      const failure = this.failed.get(id);
      let health: ModuleHealth | null = null;
      if (instance) health = healthOf(instance);
      else if (failure !== undefined) health = { status: 'failed', code: failure };
      return { module, running: instance !== undefined, health };
    });
  }

  /**
   * Cancels a start in progress and waits until it settles, then drains every running module in
   * reverse start order within `budgetMs` in total and stops each. Idempotent: startup rollback
   * and process close may both call it, also while the modules are still starting.
   */
  shutdown(budgetMs: number): Promise<void> {
    this.closing ??= this.close(budgetMs);
    return this.closing;
  }

  private async close(budgetMs: number): Promise<void> {
    this.cancel.abort();
    // The start owns its rollback; whatever it leaves running is drained and stopped here, and
    // the caller closes the pools only after that (ADR 0079, section 4).
    await this.starting?.catch(() => undefined);
    const reverse = this.running.splice(0).reverse();
    const deadline = performance.now() + budgetMs;
    const failures: unknown[] = [];
    for (const { instance } of reverse) {
      const left = Math.max(0, Math.round(deadline - performance.now()));
      // Caught here, so a rejection after the budget never becomes an unhandled rejection.
      const drain = Promise.resolve()
        .then(() => instance.drain(left))
        .catch((error: unknown) => {
          failures.push(error);
        });
      await bounded(drain, left);
    }
    failures.push(...(await stopAll(reverse)));
    if (failures.length > 0) throw new AggregateError(failures, 'Module shutdown failed');
  }
}

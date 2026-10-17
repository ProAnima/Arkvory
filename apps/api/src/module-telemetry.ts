import type {
  ModuleCounter,
  ModuleGauge,
  ModuleLog,
  ModuleLogLevel,
  ModuleLogRecord,
  ModuleManifest,
  ModuleMetrics,
} from '@proanima/arkvory-extension-api';
import type { DiagnosticRecord, MetricsRegistry } from '@proanima/arkvory-infrastructure';

/** A module's level is read as unknown: one outside the contract would bypass the log level. */
const LEVELS: readonly ModuleLogLevel[] = ['debug', 'info', 'warning', 'error'];
const CODE = /^[a-z][a-z0-9_.]{0,63}$/;
/** An identifier: no `/` or `:`, so neither a path nor a URL fits. */
const SUBJECT = /^[A-Za-z0-9._@-]{1,128}$/;
const METRIC = /^[a-z_][a-z0-9_]{0,127}$/;
/** Records one module may write per window; the rest are dropped and counted. */
const LOG_BURST = 50;
const LOG_WINDOW_MS = 10_000;
const MAX_METRICS = 32;

interface Series {
  readonly module: string;
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge';
  value: number;
}

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The log and metrics each module of the process receives (ADR 0083, section 2.4). Records are
 * checked and rate-limited per module before they reach the process log; metric names must start
 * with the module's `metricPrefix`, so a module never writes the core's series or another's.
 */
export class ModuleTelemetry {
  private readonly series: Series[] = [];
  private registry: MetricsRegistry | undefined;
  private readonly windows = new Map<string, { start: number; written: number }>();

  constructor(
    private readonly sink: { write(record: DiagnosticRecord): void },
    private readonly now: () => number,
  ) {}

  log(manifest: ModuleManifest): ModuleLog {
    return {
      write: (level, record) => {
        this.write(manifest.id, level, record);
      },
    };
  }

  private write(module: string, level: ModuleLogLevel, record: ModuleLogRecord): void {
    if (!this.admit(module)) return;
    const { code, subject, durationMs, count } = record;
    const valid =
      LEVELS.includes(level) &&
      typeof code === 'string' &&
      CODE.test(code) &&
      (subject === undefined || (typeof subject === 'string' && SUBJECT.test(subject))) &&
      (durationMs === undefined || amount(durationMs)) &&
      (count === undefined || amount(count));
    if (!valid) {
      this.sink.write({
        level: 'warning',
        component: 'module',
        code: 'module.log_invalid',
        module,
      });
      return;
    }
    this.sink.write({
      level,
      component: 'module',
      code: `module.${code}`,
      module,
      ...(subject === undefined ? {} : { subject }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(count === undefined ? {} : { count }),
    });
  }

  /** Fixed windows per module; the first refused record of a window says how the log is cut. */
  private admit(module: string): boolean {
    const at = this.now();
    let window = this.windows.get(module);
    if (!window || at - window.start >= LOG_WINDOW_MS) {
      window = { start: at, written: 0 };
      this.windows.set(module, window);
    }
    window.written++;
    if (window.written === LOG_BURST + 1)
      this.sink.write({
        level: 'warning',
        component: 'module',
        code: 'module.log_suppressed',
        module,
      });
    return window.written <= LOG_BURST;
  }

  metrics(manifest: ModuleManifest): ModuleMetrics {
    const claim = (name: string, help: string, type: Series['type']): Series => {
      const prefix = manifest.metricPrefix;
      const own = this.series.filter((s) => s.module === manifest.id);
      if (
        prefix === null ||
        !METRIC.test(name) ||
        !name.startsWith(prefix) ||
        name === prefix ||
        this.series.some((s) => s.name === name) ||
        own.length >= MAX_METRICS ||
        typeof help !== 'string' ||
        help.length > 256
      )
        throw new TypeError('Refused module metric');
      const created: Series = { module: manifest.id, name, help, type, value: 0 };
      this.series.push(created);
      if (this.registry) this.expose(this.registry, created);
      return created;
    };
    return {
      counter: (name, help): ModuleCounter => {
        const series = claim(name, help, 'counter');
        return {
          add: (value = 1) => {
            if (!amount(value)) throw new RangeError('Invalid counter amount');
            series.value += value;
          },
        };
      },
      gauge: (name, help): ModuleGauge => {
        const series = claim(name, help, 'gauge');
        return {
          set: (value) => {
            if (typeof value !== 'number' || !Number.isFinite(value))
              throw new RangeError('Invalid gauge value');
            series.value = value;
          },
        };
      },
    };
  }

  /** Publishes the modules' series now and every series registered later. */
  register(registry: MetricsRegistry): void {
    this.registry = registry;
    for (const series of this.series) this.expose(registry, series);
  }

  private expose(registry: MetricsRegistry, series: Series): void {
    registry.sampled({
      name: series.name,
      help: series.help,
      type: series.type,
      labels: [],
      collect: () => [{ labels: {}, value: series.value }],
    });
  }
}

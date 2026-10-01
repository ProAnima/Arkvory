/**
 * Dependency-free Prometheus text exposition (format 0.0.4) for process-local metrics.
 * Values live in memory and reset on restart. Cardinality is bounded twice: callers supply only
 * bounded label values (route templates, methods, status classes), and every metric caps its
 * series; once the cap is reached new label sets fold into one series whose labels are "other".
 */
export type MetricLabels = Readonly<Record<string, string>>;
export interface GaugeSample {
  readonly labels: MetricLabels;
  readonly value: number;
}

const metricName = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const labelName = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const overflowValue = 'other';

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}
function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  return String(value);
}
function validateLabels(names: readonly string[]): void {
  for (const name of names)
    if (!labelName.test(name) || name.startsWith('__')) throw new Error(`Invalid label ${name}`);
}
function labelValues(names: readonly string[], labels: MetricLabels): string[] {
  return names.map((name) => (labels[name] ?? '').slice(0, 128));
}
function labelText(names: readonly string[], values: readonly string[], extra = ''): string {
  const pairs = names.map((name, index) => `${name}="${escapeLabel(values[index] ?? '')}"`);
  if (extra) pairs.push(extra);
  return pairs.length ? `{${pairs.join(',')}}` : '';
}

/** Maps label sets to series slots, folding new sets into one overflow slot past the cap. */
class LabelSpace<T> {
  private readonly series = new Map<string, { values: readonly string[]; state: T }>();
  overflowed = 0;
  constructor(
    readonly names: readonly string[],
    private readonly maxSeries: number,
    private readonly create: () => T,
  ) {
    validateLabels(names);
    if (!Number.isSafeInteger(maxSeries) || maxSeries < 1) throw new Error('Invalid series cap');
  }
  slot(labels: MetricLabels): T {
    let values = labelValues(this.names, labels);
    let key = JSON.stringify(values);
    if (!this.series.has(key) && this.series.size >= this.maxSeries) {
      this.overflowed++;
      values = this.names.map(() => overflowValue);
      key = JSON.stringify(values);
    }
    let entry = this.series.get(key);
    if (!entry) {
      entry = { values, state: this.create() };
      this.series.set(key, entry);
    }
    return entry.state;
  }
  entries(): Iterable<{ values: readonly string[]; state: T }> {
    return this.series.values();
  }
}

export class Counter {
  private readonly space: LabelSpace<{ value: number }>;
  constructor(
    readonly name: string,
    readonly help: string,
    labels: readonly string[],
    maxSeries: number,
  ) {
    this.space = new LabelSpace(labels, maxSeries, () => ({ value: 0 }));
  }
  get overflowed(): number {
    return this.space.overflowed;
  }
  inc(labels: MetricLabels = {}, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    this.space.slot(labels).value += amount;
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} counter`];
    for (const { values, state } of this.space.entries())
      lines.push(`${this.name}${labelText(this.space.names, values)} ${formatValue(state.value)}`);
    return lines;
  }
}

interface HistogramState {
  readonly buckets: number[];
  sum: number;
  count: number;
}
export class Histogram {
  private readonly space: LabelSpace<HistogramState>;
  constructor(
    readonly name: string,
    readonly help: string,
    labels: readonly string[],
    private readonly bounds: readonly number[],
    maxSeries: number,
  ) {
    if (
      bounds.length === 0 ||
      bounds.some(
        (bound, index) => !Number.isFinite(bound) || bound <= (bounds[index - 1] ?? -Infinity),
      )
    )
      throw new Error('Histogram buckets must be finite and strictly increasing');
    if (labels.includes('le')) throw new Error('Histogram label le is reserved');
    this.space = new LabelSpace(labels, maxSeries, () => ({
      buckets: bounds.map(() => 0),
      sum: 0,
      count: 0,
    }));
  }
  get overflowed(): number {
    return this.space.overflowed;
  }
  observe(labels: MetricLabels, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const state = this.space.slot(labels);
    const index = this.bounds.findIndex((bound) => value <= bound);
    if (index >= 0) state.buckets[index] = (state.buckets[index] ?? 0) + 1;
    state.sum += value;
    state.count++;
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} histogram`];
    const names = this.space.names;
    for (const { values, state } of this.space.entries()) {
      let cumulative = 0;
      this.bounds.forEach((bound, index) => {
        cumulative += state.buckets[index] ?? 0;
        const le = `le="${formatValue(bound)}"`;
        lines.push(`${this.name}_bucket${labelText(names, values, le)} ${String(cumulative)}`);
      });
      lines.push(
        `${this.name}_bucket${labelText(names, values, 'le="+Inf"')} ${String(state.count)}`,
      );
      lines.push(`${this.name}_sum${labelText(names, values)} ${formatValue(state.sum)}`);
      lines.push(`${this.name}_count${labelText(names, values)} ${String(state.count)}`);
    }
    return lines;
  }
}

/** A metric read from another component's state when the page is rendered. */
export interface SampledMetric {
  readonly name: string;
  readonly help: string;
  /** counter: a monotonic total kept elsewhere (for example admission rejections). */
  readonly type: 'gauge' | 'counter';
  readonly labels: readonly string[];
  readonly collect: () => Iterable<GaugeSample>;
}

export class MetricsRegistry {
  private readonly metrics: { render(): string[] }[] = [];
  private readonly names = new Set<string>();
  private readonly overflow: { readonly name: string; readonly overflowed: number }[] = [];
  constructor(private readonly maxSeries = 2048) {}

  private claim(name: string): void {
    if (!metricName.test(name) || this.names.has(name)) throw new Error(`Invalid metric ${name}`);
    this.names.add(name);
  }
  counter(name: string, help: string, labels: readonly string[] = []): Counter {
    this.claim(name);
    const counter = new Counter(name, help, labels, this.maxSeries);
    this.metrics.push(counter);
    this.overflow.push(counter);
    return counter;
  }
  histogram(
    name: string,
    help: string,
    labels: readonly string[],
    buckets: readonly number[],
  ): Histogram {
    this.claim(name);
    const histogram = new Histogram(name, help, labels, buckets, this.maxSeries);
    this.metrics.push(histogram);
    this.overflow.push(histogram);
    return histogram;
  }
  /** Sampled at render time; a failing collector omits its samples, never the whole page. */
  sampled(metric: SampledMetric): void {
    this.claim(metric.name);
    validateLabels(metric.labels);
    const { name, labels } = metric;
    const header = [`# HELP ${name} ${escapeHelp(metric.help)}`, `# TYPE ${name} ${metric.type}`];
    this.metrics.push({
      render: () => {
        const samples: string[] = [];
        try {
          for (const sample of metric.collect()) {
            const values = labelValues(labels, sample.labels);
            samples.push(`${name}${labelText(labels, values)} ${formatValue(sample.value)}`);
          }
        } catch {
          samples.length = 0;
        }
        return [...header, ...samples];
      },
    });
  }
  render(): string {
    const lines = this.metrics.flatMap((metric) => metric.render());
    lines.push(
      '# HELP arkvory_metrics_series_overflow_total Label sets folded into the "other" series.',
      '# TYPE arkvory_metrics_series_overflow_total counter',
      ...this.overflow.map(
        (metric) =>
          `arkvory_metrics_series_overflow_total{metric="${metric.name}"} ${String(metric.overflowed)}`,
      ),
    );
    return lines.join('\n') + '\n';
  }
}

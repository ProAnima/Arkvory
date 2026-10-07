import type { FastifyInstance } from 'fastify';
import { MetricsRegistry } from '@proanima/arkvory-infrastructure';
import type {
  AdmissionQueue,
  Counter,
  DiagnosticLogger,
  GaugeSample,
  Histogram,
  JobBacklog,
  ProcessIdentity,
} from '@proanima/arkvory-infrastructure';
import { observeResponses } from './response-observer.js';
import type { ObservedResponse } from './response-observer.js';

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
// Seconds: control calls resolve in milliseconds, byte transfers may take up to the deadline.
export const durationBuckets = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 1800,
] as const;
const backlogTtlMs = 5000;

export function statusClass(status: number): string {
  return Number.isInteger(status) && status >= 100 && status < 600
    ? `${String(Math.floor(status / 100))}xx`
    : 'other';
}
function methodLabel(method: string): string {
  return methods.has(method) ? method : 'OTHER';
}

export interface MetricSources {
  readonly identity: ProcessIdentity;
  readonly transfers: {
    readonly uploadGate: Pick<AdmissionQueue, 'snapshot'>;
    readonly downloadGate: Pick<AdmissionQueue, 'snapshot'>;
  };
  /** Admitted non-health requests (graceful drain tracking). */
  readonly activeRequests: () => number;
  readonly diagnostics: Pick<DiagnosticLogger, 'counters'>;
  readonly jobs?: { backlog(): Promise<JobBacklog> };
  /** Database-backed backup gauges with their own cache (ADR 0056). */
  readonly backup?: {
    refresh(failed: () => void): Promise<void>;
    register(registry: MetricsRegistry): void;
  };
  /** Mirror synchronization gauges, same cache rules (ADR 0058). */
  readonly mirrors?: {
    refresh(failed: () => void): Promise<void>;
    register(registry: MetricsRegistry): void;
  };
  /** Webhook delivery gauges, same cache rules (ADR 0069). */
  readonly webhooks?: {
    refresh(failed: () => void): Promise<void>;
    register(registry: MetricsRegistry): void;
  };
  /** Monotonic milliseconds for durations and cache age. */
  readonly now: () => number;
  readonly startedAtSeconds: number;
  readonly residentMemory: () => number;
  /** Built-in HTTPS certificate expiry; absent when TLS terminates elsewhere. */
  readonly tlsNotAfterMs?: () => number;
}

/**
 * Process-local Prometheus metrics of one API process. Labels are bounded: route template (or
 * "unmatched"), normalized method and status class. Values reset when the process restarts.
 */
export class ApiMetrics {
  private readonly registry = new MetricsRegistry();
  private readonly requests: Counter;
  private readonly durations: Histogram;
  private readonly sent: Counter;
  private readonly received: Counter;
  private readonly collectionFailures: Counter;
  private backlog: JobBacklog | undefined;
  private backlogAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;

  constructor(private readonly sources: MetricSources) {
    const labels = ['method', 'route', 'status_class'];
    const r = this.registry;
    this.requests = r.counter('arkvory_http_requests_total', 'Closed HTTP responses.', labels);
    this.durations = r.histogram(
      'arkvory_http_request_duration_seconds',
      'Time from request start to response close, aborted transfers included.',
      labels,
      durationBuckets,
    );
    this.sent = r.counter(
      'arkvory_http_response_bytes_total',
      'Socket bytes written for responses, headers included.',
      ['method', 'route'],
    );
    this.received = r.counter(
      'arkvory_http_request_bytes_total',
      'Socket bytes read for requests, headers included.',
      ['method', 'route'],
    );
    this.collectionFailures = r.counter(
      'arkvory_metrics_collection_failures_total',
      'Failed collections of database-backed metrics.',
      ['collector'],
    );
    this.registerProcess();
    this.registerTls();
    this.registerTransfers();
    this.registerJobs();
    sources.backup?.register(this.registry);
    sources.mirrors?.register(this.registry);
    sources.webhooks?.register(this.registry);
  }

  observe(observed: ObservedResponse): void {
    const method = methodLabel(observed.request.method);
    const labels = { method, route: observed.route, status_class: statusClass(observed.status) };
    this.requests.inc(labels);
    this.durations.observe(labels, observed.durationMs / 1000);
    if (observed.bytesSent !== undefined)
      this.sent.inc({ method, route: observed.route }, observed.bytesSent);
    if (observed.bytesReceived !== undefined)
      this.received.inc({ method, route: observed.route }, observed.bytesReceived);
  }

  async render(): Promise<string> {
    await Promise.all([
      this.refreshBacklog(),
      this.sources.backup?.refresh(() => {
        this.collectionFailures.inc({ collector: 'backup' });
      }),
      this.sources.mirrors?.refresh(() => {
        this.collectionFailures.inc({ collector: 'mirror' });
      }),
      this.sources.webhooks?.refresh(() => {
        this.collectionFailures.inc({ collector: 'webhook' });
      }),
    ]);
    return this.registry.render();
  }

  /** Single-flight and cached so frequent scrapes cannot multiply database queries. */
  private refreshBacklog(): Promise<void> {
    const jobs = this.sources.jobs;
    if (!jobs || this.sources.now() - this.backlogAt < backlogTtlMs) return Promise.resolve();
    this.refreshing ??= jobs
      .backlog()
      .then(
        (backlog) => {
          this.backlog = backlog;
        },
        () => {
          // A stale backlog would mislead alerts; omit it until the next successful query.
          this.backlog = undefined;
          this.collectionFailures.inc({ collector: 'jobs' });
        },
      )
      .finally(() => {
        this.backlogAt = this.sources.now();
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private registerTls(): void {
    const notAfter = this.sources.tlsNotAfterMs;
    if (!notAfter) return;
    this.registry.sampled({
      name: 'arkvory_tls_certificate_expiry_timestamp_seconds',
      help: 'Expiry of the certificate served by the built-in HTTPS listener (Unix seconds).',
      type: 'gauge',
      labels: [],
      collect: () => [{ labels: {}, value: Math.floor(notAfter() / 1000) }],
    });
  }

  private registerProcess(): void {
    const { identity, startedAtSeconds, residentMemory, diagnostics, activeRequests } =
      this.sources;
    const single = (value: number): GaugeSample[] => [{ labels: {}, value }];
    this.registry.sampled({
      name: 'arkvory_build_info',
      help: 'Service and release version of this process.',
      type: 'gauge',
      labels: ['service', 'version'],
      collect: () => [
        { labels: { service: identity.service, version: identity.version }, value: 1 },
      ],
    });
    this.registry.sampled({
      name: 'arkvory_process_start_time_seconds',
      help: 'Process start time, Unix seconds; a change means counters were reset.',
      type: 'gauge',
      labels: [],
      collect: () => single(startedAtSeconds),
    });
    this.registry.sampled({
      name: 'arkvory_process_resident_memory_bytes',
      help: 'Resident set size.',
      type: 'gauge',
      labels: [],
      collect: () => single(residentMemory()),
    });
    this.registry.sampled({
      name: 'arkvory_http_requests_in_flight',
      help: 'Admitted non-health requests whose responses are still open.',
      type: 'gauge',
      labels: [],
      collect: () => single(activeRequests()),
    });
    this.registry.sampled({
      name: 'arkvory_diagnostic_records_total',
      help: 'Diagnostic lines by outcome; dropped lines were discarded under stdout backpressure.',
      type: 'counter',
      labels: ['outcome'],
      collect: () => {
        const counters = diagnostics.counters;
        return (['written', 'dropped', 'truncated', 'oversized'] as const).map((outcome) => ({
          labels: { outcome },
          value: counters[outcome],
        }));
      },
    });
  }

  private registerTransfers(): void {
    const { uploadGate, downloadGate } = this.sources.transfers;
    const gates = [
      ['upload', uploadGate],
      ['download', downloadGate],
    ] as const;
    const per = (pick: (snapshot: AdmissionQueue['snapshot']) => number) => () =>
      gates.map(([direction, gate]) => ({ labels: { direction }, value: pick(gate.snapshot) }));
    this.registry.sampled({
      name: 'arkvory_transfer_active',
      help: 'Admitted byte transfers.',
      type: 'gauge',
      labels: ['direction'],
      collect: per((snapshot) => snapshot.active),
    });
    this.registry.sampled({
      name: 'arkvory_transfer_queue_depth',
      help: 'Transfers waiting for admission.',
      type: 'gauge',
      labels: ['direction'],
      collect: per((snapshot) => snapshot.waiting),
    });
    this.registry.sampled({
      name: 'arkvory_transfer_admission_failures_total',
      help: 'Transfers refused by admission: queue full, wait timeout or caller cancellation.',
      type: 'counter',
      labels: ['direction', 'reason'],
      collect: () =>
        gates.flatMap(([direction, gate]) => {
          const { rejected, timedOut, cancelled } = gate.snapshot;
          return [
            { labels: { direction, reason: 'rejected' }, value: rejected },
            { labels: { direction, reason: 'timed_out' }, value: timedOut },
            { labels: { direction, reason: 'cancelled' }, value: cancelled },
          ];
        }),
    });
  }

  private registerJobs(): void {
    this.registry.sampled({
      name: 'arkvory_completion_jobs',
      help: 'Active completion jobs in the shared database, cached up to 5 seconds.',
      type: 'gauge',
      labels: ['state'],
      collect: () =>
        this.backlog
          ? [
              { labels: { state: 'queued' }, value: this.backlog.queued },
              { labels: { state: 'running' }, value: this.backlog.running },
            ]
          : [],
    });
    this.registry.sampled({
      name: 'arkvory_completion_oldest_queued_seconds',
      help: 'Wait of the longest-waiting runnable queued job; retry backoff is excluded.',
      type: 'gauge',
      labels: [],
      collect: () =>
        this.backlog ? [{ labels: {}, value: this.backlog.oldestQueuedSeconds }] : [],
    });
  }
}

export const metricsContentType = 'text/plain; version=0.0.4; charset=utf-8';

/** Same authorization as /health/ready: any valid credential; outside the request budget. */
export function registerMetrics(app: FastifyInstance, metrics: ApiMetrics, now: () => number) {
  observeResponses(app, now, (observed) => {
    metrics.observe(observed);
  });
  app.get('/health/metrics', async (_request, reply) =>
    reply.type(metricsContentType).send(await metrics.render()),
  );
}

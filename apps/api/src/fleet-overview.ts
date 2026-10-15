import {
  fleetAlerts,
  fleetLinks,
  type FleetAlert,
  type HealthSite,
} from '@proanima/arkvory-domain';
import { readFleetSite, type FleetSite, type SiteTopology } from '@proanima/arkvory-contracts';
import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';

/** Scrapes and console refreshes share one reading per this period. */
const TTL_MS = 5000;
/** The background read of sites (ADR 0077): every 30 seconds. */
const POLL_MS = 30000;
/**
 * One round reads at most this many sites at once (FleetControl's CONCURRENCY), each within this
 * deadline (the fleet client's DEADLINE_MS): the longest a round of N sites takes is
 * ceil(N / 8) × 15 s, which a site that answers may wait for its next read without being stale.
 */
const ROUND_CONCURRENCY = 8;
const ROUND_DEADLINE_MS = 15000;

export interface FleetOverviewOptions {
  readonly name: string;
  readonly version: string;
  /** Where other sites reach this installation (`ARKVORY_SITE_URL`); links to it need it. */
  readonly url: string | null;
  /** Changes behind its source at which a mirror alerts (`ARKVORY_FLEET_LAG_ALERT`). */
  readonly lagLimit: bigint;
  /** Wall clock (ms) of alert times and ages, the clock `seenAt` is written by. */
  readonly now: () => number;
  /** Monotonic clock (ms) of the cache period: a step of the wall clock never freezes it. */
  readonly monotonic: () => number;
}

/**
 * What the controller last read of a site, kept while it does not answer: links and lag show it
 * as last known, and the alert rules read it only from a site that answers.
 */
function health(site: FleetSite): HealthSite {
  return {
    id: site.id,
    name: site.name,
    url: site.url,
    state: site.state,
    addedAt: Date.parse(site.addedAt),
    seenAt: site.seenAt === null ? null : Date.parse(site.seenAt),
    report: site.topology && reportOf(site.topology),
  };
}

function reportOf(topology: SiteTopology): NonNullable<HealthSite['report']> {
  const until = topology.replication?.singleCopyUntil ?? null;
  return {
    version: topology.site.version,
    role: topology.site.role,
    writable: topology.health.writable,
    draining: topology.health.draining,
    copies: topology.replication?.copies ?? null,
    required: topology.replication?.required ?? null,
    singleCopyUntil: until === null ? null : Date.parse(until),
    updatesError: topology.updates?.error ?? null,
    mirrors: topology.mirrors.map((mirror) => ({
      repository: mirror.repository,
      upstream: mirror.upstream,
      sourceRepository: mirror.sourceRepository,
      mode: mirror.mode,
      lagChanges: mirror.lagChanges,
      errorCode: mirror.errorCode,
    })),
  };
}

interface Reading {
  readonly at: number;
  /** The monotonic time it was built. */
  readonly mark: number;
  readonly sites: readonly HealthSite[];
  readonly alerts: readonly FleetAlert[];
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * The fleet at a glance (ADR 0077, stage F4) on the controller: alerts and links from the last
 * reads of every site and from this installation itself, and the fleet gauges of `/health/metrics`.
 * Built at most once per 5 seconds, whoever asks; a stored site that no longer reads as the
 * contract says counts as not read, it never fails the whole overview.
 */
export class FleetOverviewSource {
  private reading: Reading | undefined;
  private building: Promise<Reading> | undefined;

  constructor(
    private readonly sites: { list(): Promise<readonly unknown[]> },
    private readonly self: () => Promise<SiteTopology>,
    private readonly options: FleetOverviewOptions,
  ) {}

  async overview() {
    const reading = await this.read();
    const { links, external } = fleetLinks(reading.sites);
    return {
      generatedAt: new Date(reading.at).toISOString(),
      self: { name: this.options.name, version: this.options.version, url: this.options.url },
      alerts: reading.alerts.map((alert) => ({ ...alert, since: iso(alert.since) })),
      links,
      external,
    };
  }

  /**
   * For the metrics: refreshes the reading, reporting a failure instead of throwing. The last
   * reading stays: gauges that vanished on every failed collection would reset the `for` of the
   * fleet alert rules, and a site that is down would never be reported while collection flaps.
   * The failure itself is counted (`arkvory_metrics_collection_failures_total`).
   */
  refresh(failed: () => void): Promise<void> {
    return this.read().then(
      () => undefined,
      () => {
        failed();
      },
    );
  }

  private read(): Promise<Reading> {
    const mark = this.options.monotonic();
    if (this.reading && mark - this.reading.mark < TTL_MS) return Promise.resolve(this.reading);
    this.building ??= this.build(mark).finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private async build(mark: number): Promise<Reading> {
    const [stored, own] = await Promise.all([this.sites.list(), this.self()]);
    const now = this.options.now();
    const sites: HealthSite[] = [
      {
        id: 'self',
        name: this.options.name,
        url: this.options.url,
        state: 'ok',
        addedAt: now,
        seenAt: now,
        report: reportOf(own),
      },
      ...stored.map((value, index) => {
        try {
          return health(readFleetSite(value));
        } catch {
          return unread(value, index, now);
        }
      }),
    ];
    const alerts = fleetAlerts(sites, {
      now,
      pollMs: POLL_MS,
      roundMs: Math.ceil(stored.length / ROUND_CONCURRENCY) * ROUND_DEADLINE_MS,
      lagLimit: this.options.lagLimit,
      version: this.options.version,
    });
    this.reading = { at: now, mark, sites, alerts };
    return this.reading;
  }

  register(registry: MetricsRegistry): void {
    const sites = () => this.reading?.sites.filter((site) => site.id !== 'self') ?? [];
    registry.sampled({
      name: 'arkvory_fleet_site_up',
      help: 'Managed site (ADR 0077): 1 when its last read answered, 0 otherwise.',
      type: 'gauge',
      labels: ['site', 'name'],
      collect: () =>
        sites().map((site) => ({
          labels: { site: site.id, name: site.name },
          value: site.state === 'ok' ? 1 : 0,
        })),
    });
    registry.sampled({
      name: 'arkvory_fleet_site_last_seen_timestamp_seconds',
      help: 'Last time a managed site answered the controller (Unix seconds).',
      type: 'gauge',
      labels: ['site', 'name'],
      collect: () =>
        sites().flatMap((site) =>
          site.seenAt === null
            ? []
            : [
                {
                  labels: { site: site.id, name: site.name },
                  value: Math.floor(site.seenAt / 1000),
                },
              ],
        ),
    });
    registry.sampled({
      name: 'arkvory_fleet_mirror_lag_changes',
      help: 'Changes of the source a mirror of a managed site has not applied yet.',
      type: 'gauge',
      labels: ['site', 'repository'],
      collect: () =>
        (this.reading?.sites ?? []).flatMap((site) =>
          (site.report?.mirrors ?? []).flatMap((mirror) => {
            // At most 30 digits by contract; a value that still is no finite number is left out.
            const value = mirror.lagChanges === null ? NaN : Number(mirror.lagChanges);
            return Number.isFinite(value)
              ? [{ labels: { site: site.id, repository: mirror.repository }, value }]
              : [];
          }),
        ),
    });
    registry.sampled({
      name: 'arkvory_fleet_mirror_lag_alert_changes',
      help: 'Changes behind at which a mirror alerts (ARKVORY_FLEET_LAG_ALERT); alert rules compare with it.',
      type: 'gauge',
      labels: [],
      collect: () => {
        const value = Number(this.options.lagLimit);
        return Number.isFinite(value) ? [{ labels: {}, value }] : [];
      },
    });
    registry.sampled({
      name: 'arkvory_fleet_alerts',
      help: 'Alerts of the fleet console by severity and kind, this installation included.',
      type: 'gauge',
      labels: ['severity', 'kind'],
      collect: () => {
        const counts = new Map<string, { severity: string; kind: string; value: number }>();
        for (const alert of this.reading?.alerts ?? []) {
          const key = `${alert.severity}/${alert.kind}`;
          const entry = counts.get(key) ?? { severity: alert.severity, kind: alert.kind, value: 0 };
          counts.set(key, { ...entry, value: entry.value + 1 });
        }
        return [...counts.values()].map(({ severity, kind, value }) => ({
          labels: { severity, kind },
          value,
        }));
      },
    });
  }
}

/**
 * A stored site that does not read as the contract says: its id and name, and nothing read.
 * Without an id of its own it gets `unknown:<position>`, so two such rows never share a series.
 */
function unread(value: unknown, index: number, now: number): HealthSite {
  const row = typeof value === 'object' && value !== null ? value : {};
  const id: unknown = Reflect.get(row, 'id');
  const name: unknown = Reflect.get(row, 'name');
  return {
    id: typeof id === 'string' && id !== '' ? id : `unknown:${String(index)}`,
    name: typeof name === 'string' ? name : 'unknown',
    url: null,
    state: 'invalid',
    addedAt: now,
    seenAt: null,
    report: null,
  };
}

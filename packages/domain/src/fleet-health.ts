/**
 * Alerts and links of the fleet console (ADR 0077, stage F4): pure rules over what the controller
 * last read from each site. Times are milliseconds of the caller's clock; nothing here reads one.
 */

/**
 * The name of an installation in the fleet: any script, no control codes (C0, DEL, C1), 1 to 63
 * code points. The same rule on the site that names itself and on the controller that stores it.
 */
export function isFleetName(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  const points = Array.from(value);
  return points.length >= 1 && points.length <= 63 && !points.some(isControl);
}

/** C0 controls, DEL and C1 controls: never part of a name shown to people. */
export function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

export interface HealthMirror {
  readonly repository: string;
  /** The source as the mirror stores it; compared by `siteOrigin`. */
  readonly upstream: string;
  readonly sourceRepository: string;
  readonly mode: 'mirror' | 'import';
  /** Changes of the source not applied yet; a decimal of any size, null before the first check. */
  readonly lagChanges: string | null;
  readonly errorCode: string | null;
}
export interface HealthSite {
  /** `self` for the controller itself, else the site id. */
  readonly id: string;
  readonly name: string;
  /** The address the site is managed at (null for the controller without ARKVORY_SITE_URL). */
  readonly url: string | null;
  readonly state:
    'ok' | 'pending' | 'unreachable' | 'certificate' | 'revoked' | 'invalid' | 'refused';
  readonly addedAt: number;
  readonly seenAt: number | null;
  /** Null while the site was never read: everything below is then unknown. */
  readonly report: {
    readonly version: string;
    readonly role: 'api' | 'reader';
    readonly writable: boolean;
    readonly draining: boolean;
    readonly copies: number | null;
    readonly required: number | null;
    readonly singleCopyUntil: number | null;
    readonly updatesError: string | null;
    readonly mirrors: readonly HealthMirror[];
  } | null;
}

export type FleetAlertKind =
  | 'unreachable'
  | 'certificate'
  | 'revoked'
  | 'refused'
  | 'invalid'
  | 'stale'
  | 'not-writable'
  | 'copies'
  | 'single-copy'
  | 'mirror-failing'
  | 'mirror-lag'
  | 'updates-failed'
  | 'version-skew';
export type FleetAlertSeverity = 'critical' | 'warning' | 'info';
export interface FleetAlert {
  readonly site: string;
  readonly name: string;
  readonly kind: FleetAlertKind;
  readonly severity: FleetAlertSeverity;
  /** The repository of a mirror alert; null for the site as a whole. */
  readonly subject: string | null;
  /** Since when, when known: the last good answer of a site that stopped answering. */
  readonly since: number | null;
}
export interface FleetHealthOptions {
  readonly now: number;
  /** How often the controller reads sites; a read older than three periods is stale. */
  readonly pollMs: number;
  /** A mirror this many changes behind its source alerts. */
  readonly lagLimit: bigint;
  /** The controller's version: other versions are reported for planning updates. */
  readonly version: string;
}

/** One failed read is no alert: a site is unreachable after this long without an answer. */
export const UNREACHABLE_GRACE_MS = 120_000;
const failures = ['certificate', 'revoked', 'refused', 'invalid'] as const;
const rank: Record<FleetAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * `scheme://host[:port]` in one spelling: lower case, no default port, no trailing slash. Null for
 * anything else, so two spellings of one site meet and a malformed upstream links to nothing.
 */
export function siteOrigin(value: string): string | null {
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').toLowerCase().replace(/\.$/, '');
  const port = match[3] === undefined ? '' : String(Number(match[3]));
  const fallback = scheme === 'https' ? '443' : '80';
  if (!host || (port !== '' && (Number(port) < 1 || Number(port) > 65535))) return null;
  return `${scheme}://${host}${port && port !== fallback ? `:${port}` : ''}`;
}

/** A decimal of any size, or null when it is not one: lag stays exact beyond 2^53. */
function decimal(value: string | null): bigint | null {
  return value !== null && /^(0|[1-9][0-9]{0,39})$/.test(value) ? BigInt(value) : null;
}

function siteAlerts(site: HealthSite, options: FleetHealthOptions): FleetAlert[] {
  const alert = (
    kind: FleetAlertKind,
    severity: FleetAlertSeverity,
    subject: string | null = null,
    since: number | null = null,
  ): FleetAlert => ({ site: site.id, name: site.name, kind, severity, subject, since });
  const found: FleetAlert[] = [];
  // A clock ahead of ours is not "fresh forever": an answer from the future counts as now.
  const seen = site.seenAt === null ? null : Math.min(site.seenAt, options.now);
  const silent = options.now - (seen ?? site.addedAt);
  for (const failure of failures)
    if (site.state === failure) found.push(alert(failure, 'critical'));
  if ((site.state === 'unreachable' || site.state === 'pending') && silent >= UNREACHABLE_GRACE_MS)
    found.push(alert('unreachable', 'critical', null, seen));
  else if (site.state === 'ok' && silent > 3 * options.pollMs)
    found.push(alert('stale', 'warning', null, seen));
  const report = site.report;
  if (!report) return found;
  // A draining writer refuses writes on purpose; a read gateway never writes.
  if (report.role === 'api' && !report.writable && !report.draining)
    found.push(alert('not-writable', 'critical'));
  // Missing copies page until an operator decided to accept one copy for a while.
  if (report.copies !== null && report.required !== null && report.copies < report.required) {
    const decided = report.singleCopyUntil !== null && report.singleCopyUntil > options.now;
    found.push(decided ? alert('single-copy', 'warning') : alert('copies', 'critical'));
  }
  if (report.updatesError !== null) found.push(alert('updates-failed', 'warning'));
  if (report.version !== options.version) found.push(alert('version-skew', 'info'));
  for (const mirror of report.mirrors) {
    // Reading a restored source again is no failure (as the mirror metrics say).
    if (mirror.errorCode !== null && mirror.errorCode !== 'mirror_source_behind')
      found.push(alert('mirror-failing', 'warning', mirror.repository));
    const lag = decimal(mirror.lagChanges);
    if (lag !== null && lag >= options.lagLimit)
      found.push(alert('mirror-lag', 'warning', mirror.repository));
  }
  return found;
}

/** Every alert of the fleet, most severe first, then by site name and kind: a stable order. */
export function fleetAlerts(
  sites: readonly HealthSite[],
  options: FleetHealthOptions,
): FleetAlert[] {
  return sites
    .flatMap((site) => siteAlerts(site, options))
    .sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        a.name.localeCompare(b.name) ||
        a.site.localeCompare(b.site) ||
        a.kind.localeCompare(b.kind) ||
        (a.subject ?? '').localeCompare(b.subject ?? ''),
    );
}

export interface FleetLink {
  /** A site id, `self`, or `external:<origin>` for a source this controller does not manage. */
  readonly from: string;
  readonly to: string;
  readonly repository: string;
  readonly sourceRepository: string;
  readonly mode: 'mirror' | 'import';
  readonly lagChanges: string | null;
  readonly failing: boolean;
}

/**
 * Who feeds whom: each mirror or import of a site, from the site whose address is its source.
 * Sources no managed site answers at become external nodes. Cycles and a site mirroring itself
 * are kept as they are: they are facts to show, not errors to hide.
 */
export function fleetLinks(sites: readonly HealthSite[]): {
  readonly links: FleetLink[];
  readonly external: string[];
} {
  const byOrigin = new Map<string, string>();
  for (const site of sites) {
    const origin = site.url === null ? null : siteOrigin(site.url);
    // Two sites at one address: the first keeps it, so a link never points at both.
    if (origin !== null && !byOrigin.has(origin)) byOrigin.set(origin, site.id);
  }
  const external = new Set<string>();
  const links: FleetLink[] = [];
  for (const site of sites)
    for (const mirror of site.report?.mirrors ?? []) {
      const origin = siteOrigin(mirror.upstream) ?? mirror.upstream;
      const from = byOrigin.get(origin) ?? `external:${origin}`;
      if (!byOrigin.has(origin)) external.add(origin);
      links.push({
        from,
        to: site.id,
        repository: mirror.repository,
        sourceRepository: mirror.sourceRepository,
        mode: mirror.mode,
        lagChanges: mirror.lagChanges,
        failing: mirror.errorCode !== null && mirror.errorCode !== 'mirror_source_behind',
      });
    }
  return { links, external: [...external].sort() };
}

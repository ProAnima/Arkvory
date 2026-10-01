export type ReadinessStatus = 'ready' | 'unavailable' | 'draining';

/**
 * Public load-balancer status. Dependency checks are single-flight and cached for ttlMs so
 * unauthenticated probes cannot multiply database queries; draining is reported immediately.
 */
export class ReadinessProbe {
  private cached: { status: 'ready' | 'unavailable'; at: number } | undefined;
  private pending: Promise<'ready' | 'unavailable'> | undefined;

  constructor(
    private readonly check: () => Promise<void>,
    private readonly draining: () => boolean,
    private readonly now: () => number,
    private readonly ttlMs = 1000,
  ) {}

  async status(): Promise<ReadinessStatus> {
    if (this.draining()) return 'draining';
    const cached = this.cached;
    if (cached && this.now() - cached.at < this.ttlMs) return cached.status;
    this.pending ??= this.check()
      .then(
        () => 'ready' as const,
        () => 'unavailable' as const,
      )
      .then((status) => {
        this.cached = { status, at: this.now() };
        this.pending = undefined;
        return status;
      });
    const status = await this.pending;
    return this.draining() ? 'draining' : status;
  }
}

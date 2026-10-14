import type { DownloadClass, DownloadSchedulePolicy } from './download-policy.js';

/** What the rules need to know of a session to count it. */
export interface Occupant {
  readonly principal: string;
  readonly class: DownloadClass;
}

/**
 * Counts of places and waiting sessions, kept as sessions move, so a decision is O(1) instead of
 * a scan over every session. Every `occupy` is paired with one `vacate`, every `wait` with one
 * `leave`; the counts return to zero when the sessions are gone.
 */
export class DownloadOccupancy {
  active = 0;
  /** Active sessions outside the people's reserve. */
  private shared = 0;
  private readonly activeOf = new Map<string, number>();
  readonly waitingOf: Record<DownloadClass, number> = {
    interactive: 0,
    release: 0,
    bulk: 0,
    background: 0,
  };
  waiting = 0;

  occupy(session: Occupant) {
    this.active++;
    if (session.class !== 'interactive') this.shared++;
    this.activeOf.set(session.principal, this.of(session.principal) + 1);
  }

  vacate(session: Occupant) {
    this.active--;
    if (session.class !== 'interactive') this.shared--;
    const left = this.of(session.principal) - 1;
    if (left <= 0) this.activeOf.delete(session.principal);
    else this.activeOf.set(session.principal, left);
  }

  wait(session: Occupant) {
    this.waiting++;
    this.waitingOf[session.class]++;
  }

  leave(session: Occupant) {
    this.waiting--;
    this.waitingOf[session.class]--;
  }

  /** Free places for people, and for everyone else outside their reserve. */
  free(policy: DownloadSchedulePolicy) {
    const all = Math.max(0, policy.slots - this.active);
    const shared = Math.max(0, policy.slots - policy.interactiveReserve - this.shared);
    return { all, shared: Math.min(all, shared) };
  }

  of(principal: string) {
    return this.activeOf.get(principal) ?? 0;
  }

  /**
   * Whether a place is free for this session: within the places, outside the people's reserve
   * unless it is a person, and, when `strict`, within its principal's share.
   */
  fits(session: Occupant, policy: DownloadSchedulePolicy, strict: boolean) {
    if (this.active >= policy.slots) return false;
    if (session.class !== 'interactive' && this.shared >= policy.slots - policy.interactiveReserve)
      return false;
    return !strict || this.of(session.principal) < policy.perPrincipalActive;
  }
}

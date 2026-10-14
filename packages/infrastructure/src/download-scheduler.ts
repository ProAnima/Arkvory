import {
  DownloadSessions,
  type DownloadDecision,
  type DownloadSchedulePolicy,
  type DownloadSessionRequest,
} from '@proanima/arkvory-domain';

/** One response of an active session; `end` is idempotent. */
export interface DownloadLease {
  progress(bytes: number): void;
  end(reachedEnd: boolean): void;
}
export type DownloadAdmission =
  | { readonly state: 'active'; readonly lease: DownloadLease }
  | Exclude<DownloadDecision, { state: 'active' }>;

/** Scheduler tick: frequent enough for prompt hand-over, rare enough to cost nothing. */
const TICK_MS = 500;

/**
 * The in-process download scheduler (ADR 0076, stage 2): the session rules of the domain driven
 * by the wall clock and one timer for all sessions. Positions and estimates refresh on the tick.
 */
export class DownloadScheduler {
  private readonly sessions: DownloadSessions;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    policy: DownloadSchedulePolicy,
    private readonly now: () => number = Date.now,
  ) {
    this.sessions = new DownloadSessions(policy);
    this.timer = setInterval(() => {
      this.sessions.plan(this.now());
    }, TICK_MS);
    this.timer.unref();
  }
  get policy() {
    return this.sessions.policy;
  }
  configure(policy: DownloadSchedulePolicy) {
    this.sessions.configure(policy);
  }
  admit(request: DownloadSessionRequest): DownloadAdmission {
    const decision = this.sessions.request(request, this.now());
    if (decision.state !== 'active') return decision;
    let ended = false;
    return {
      state: 'active',
      lease: {
        progress: (bytes) => {
          if (!ended) this.sessions.progress(request.key, bytes, this.now());
        },
        end: (reachedEnd) => {
          if (ended) return;
          ended = true;
          this.sessions.end(request.key, reachedEnd, this.now());
        },
      },
    };
  }
  /** Runs one tick now; tests and shutdown use it instead of waiting for the timer. */
  plan() {
    this.sessions.plan(this.now());
  }
  get snapshot() {
    return this.sessions.snapshot(this.now());
  }
  drain() {
    this.sessions.drain();
  }
  close() {
    clearInterval(this.timer);
  }
}

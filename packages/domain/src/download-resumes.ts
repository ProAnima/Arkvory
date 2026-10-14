/** What a download that lost its place keeps for its return. */
export interface DownloadResume {
  readonly seq: number;
  readonly arrival: number;
  readonly queuedAt: number;
  readonly served: number;
  readonly sawEnd: boolean;
}

/** How long a half-finished download keeps its turn after its place was freed. */
const KEEP_MS = 10 * 60 * 1000;

/**
 * Half-finished downloads whose place was freed by a pause (slow disk, network blip, client
 * restart). A return within ten minutes keeps its arrival order, so 9 GB of 10 GB do not go to
 * the end of the queue. Bounded: the oldest entries go first when `limit` is reached.
 */
export class DownloadResumes {
  private readonly kept = new Map<string, DownloadResume & { readonly until: number }>();
  constructor(private readonly limit: () => number) {}

  keep(key: string, resume: DownloadResume, now: number) {
    this.kept.delete(key);
    this.kept.set(key, { ...resume, until: now + KEEP_MS });
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= this.limit()) break;
      this.kept.delete(oldest);
    }
  }

  take(key: string, now: number): DownloadResume | undefined {
    const resume = this.kept.get(key);
    this.kept.delete(key);
    return resume && resume.until >= now ? resume : undefined;
  }

  /** Entries are kept in insertion order, so expired ones are at the front. */
  prune(now: number) {
    for (const [key, resume] of this.kept) {
      if (resume.until >= now) break;
      this.kept.delete(key);
    }
  }

  get size() {
    return this.kept.size;
  }
}

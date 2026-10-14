/** Seconds of traffic remembered for the rate. */
const WINDOW_SECONDS = 60;

/**
 * Bytes served per second, kept for the last minute by whole second: at most 61 numbers.
 * `capacity` is the busiest complete second, what the link can deliver. An average would fall
 * while places wait for their clients and stretch the estimates, which makes clients come later
 * and the link stand still longer.
 */
export class DownloadRate {
  private readonly seconds = new Map<number, number>();

  add(bytes: number, now: number) {
    const at = Math.floor(now / 1000);
    this.seconds.set(at, (this.seconds.get(at) ?? 0) + bytes);
    if (this.seconds.size > WINDOW_SECONDS) this.forget(at);
  }

  capacity(now: number) {
    const at = Math.floor(now / 1000);
    this.forget(at);
    let busiest = 0;
    let current = 0;
    for (const [stamp, bytes] of this.seconds)
      if (stamp < at) busiest = Math.max(busiest, bytes);
      else current = bytes;
    // Before a complete second exists, the current one is the only evidence.
    return busiest || current;
  }

  private forget(at: number) {
    for (const stamp of this.seconds.keys())
      if (stamp <= at - WINDOW_SECONDS) this.seconds.delete(stamp);
  }
}

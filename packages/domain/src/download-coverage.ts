/** Byte range of one response of a download, `end` inclusive (ADR 0076). */
export interface DownloadByteRange {
  readonly start: number;
  readonly end: number;
  /**
   * The client asked from `start` to the end of the object without naming the end (`bytes=X-`
   * or no Range at all), as a resuming tool does. A suffix range or a bounded range ending at
   * the last byte is a read of the tail (a ZIP directory) and does not say where the download
   * starts.
   */
  readonly open: boolean;
}

/** Disjoint intervals kept per session; one sequential or resumed download needs one. */
const MAX_SPANS = 64;

/**
 * The byte ranges of an object that responses delivered in full, as sorted, disjoint, merged
 * inclusive intervals. Bounded: beyond `MAX_SPANS` the smallest interval is forgotten, which can
 * only delay completion (the place is then freed by the idle time), never complete early.
 */
export class DownloadCoverage {
  private spans: { start: number; end: number }[] = [];

  add(start: number, end: number) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return;
    const next: { start: number; end: number }[] = [];
    let merged = { start, end };
    for (const span of this.spans) {
      // Adjacent intervals merge too: [0, 9] and [10, 19] are [0, 19].
      if (span.end + 1 < merged.start || merged.end + 1 < span.start) next.push(span);
      else
        merged = { start: Math.min(span.start, merged.start), end: Math.max(span.end, merged.end) };
    }
    next.push(merged);
    next.sort((a, b) => a.start - b.start);
    while (next.length > MAX_SPANS) {
      let smallest = 0;
      next.forEach((span, index) => {
        const other = next[smallest];
        if (other && span.end - span.start < other.end - other.start) smallest = index;
      });
      next.splice(smallest, 1);
    }
    this.spans = next;
  }

  /** Whether every byte from `start` to `end` was delivered. */
  covers(start: number, end: number) {
    return this.spans.some((span) => span.start <= start && span.end >= end);
  }

  /** Delivered bytes at or after `offset`. */
  bytesFrom(offset: number) {
    let bytes = 0;
    for (const span of this.spans)
      if (span.end >= offset) bytes += span.end - Math.max(span.start, offset) + 1;
    return bytes;
  }

  get size() {
    return this.spans.length;
  }
}

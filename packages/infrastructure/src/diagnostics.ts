import type { Writable } from 'node:stream';

export interface DiagnosticRecord {
  level: 'info' | 'warning' | 'error';
  component: 'api' | 'storage' | 'worker';
  code: string;
  requestId?: string;
  jobId?: string;
  route?: string;
  method?: string;
  status?: number;
  repository?: string;
  /** Access log fields; route is the template, never the raw URL or query string. */
  durationMs?: number;
  bytesSent?: number;
  principal?: string;
  clientIp?: string;
  completed?: boolean;
  /** Constant failure identifiers from failureCause and a redacted startupReason. */
  errorName?: string;
  errno?: string;
  sqlstate?: string;
  reason?: string;
}
/** Caller supplies allowlisted codes and route templates, never exception text or raw URLs. */
export class DiagnosticLogger {
  private blocked = false;
  private dropped = 0;
  private closed = false;
  private readonly drain = () => {
    this.blocked = false;
    if (this.dropped) {
      const dropped = this.dropped;
      this.dropped = 0;
      this.write({
        level: 'warning',
        component: 'storage',
        code: `diagnostics.dropped.${String(dropped)}`,
      });
    }
  };
  private readonly failed = () => {
    this.blocked = true;
  };
  constructor(
    private readonly sink: Writable,
    private readonly now: () => string,
  ) {
    sink.on('drain', this.drain);
    sink.on('error', this.failed);
  }
  write(record: DiagnosticRecord) {
    if (this.closed) return;
    if (this.blocked) {
      this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    // A single bounded record; no buffering beyond the stream high-water mark.
    const line = JSON.stringify({ timestamp: this.now(), ...record });
    if (line.length > 2048) return;
    try {
      this.blocked = !this.sink.write(line + '\n');
    } catch {
      this.failed();
    }
  }
  close() {
    this.closed = true;
    this.sink.off('drain', this.drain);
    this.sink.off('error', this.failed);
  }
}

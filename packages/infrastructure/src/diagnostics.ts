import type { Writable } from 'node:stream';

export const logLevels = ['debug', 'info', 'warning', 'error'] as const;
export type LogLevel = (typeof logLevels)[number];
/** Closed set: a new subsystem extends this union instead of inventing free-form strings. */
export type LogComponent =
  'api' | 'http' | 'storage' | 'worker' | 'maintenance' | 'migrate' | 'process' | 'diagnostics';
export type LogService = 'api' | 'worker' | 'migrate' | 'gc' | 'scrub';

/** Stable per-process fields repeated on every line so a single line is attributable. */
export interface ProcessIdentity {
  readonly service: LogService;
  readonly version: string;
  readonly pid: number;
  readonly hostname: string;
}

/**
 * Allowlisted fields. Callers pass constant codes, route templates, identifiers and numbers;
 * never exception messages, raw URLs, headers or credentials. `reason` is the only free text
 * and must already be redacted (startupReason/redactDiagnostic).
 */
export interface DiagnosticFields {
  requestId?: string;
  traceId?: string;
  jobId?: string;
  uploadId?: string;
  artifactId?: string;
  route?: string;
  method?: string;
  status?: number;
  repository?: string;
  durationMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  principal?: string;
  clientIp?: string;
  completed?: boolean;
  attempts?: number;
  generation?: number;
  errorCode?: string;
  errorName?: string;
  errno?: string;
  sqlstate?: string;
  reason?: string;
  address?: string;
  port?: number;
  signal?: string;
  origin?: string;
  activeRequests?: number;
  drainWindowMs?: number;
  fromSchema?: number;
  toSchema?: number;
  checked?: number;
  failed?: number;
  visited?: number;
  collected?: number;
  dropped?: number;
  truncated?: number;
  recordCode?: string;
  tls?: boolean;
  notAfter?: string;
  daysLeft?: number;
}
export interface DiagnosticRecord extends DiagnosticFields {
  level: LogLevel;
  component: LogComponent;
  code: string;
}
export interface DiagnosticCounters {
  readonly written: number;
  readonly dropped: number;
  readonly truncated: number;
  readonly oversized: number;
}
export interface DiagnosticOptions {
  /** Records below this level are discarded before serialization. Default: info. */
  readonly level?: LogLevel;
  readonly process?: ProcessIdentity;
}

const rank: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warning: 2, error: 3 };
/** One line stays far below PIPE_BUF multiples and typical collector line limits. */
export const MAX_DIAGNOSTIC_LINE = 4096;
const textLimit = 256;
const reasonLimit = 240;

/** Strict: an unknown level is a configuration error, not a silent default. */
export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return 'info';
  const level = logLevels.find((candidate) => candidate === raw);
  if (!level) throw new Error('Invalid ARKVORY_LOG_LEVEL');
  return level;
}

function clipped(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) + '…' : value;
}

/**
 * Non-blocking JSON-lines logger. Backpressure contract: while the sink reports a full buffer
 * (write() returned false) or failed, records are counted and discarded rather than queued, so
 * a slow collector can never grow memory or stall a transfer; the next 'drain' emits one
 * `diagnostics.dropped` record with the count. Oversized string fields are clipped and counted
 * in `truncated`; a record still above MAX_DIAGNOSTIC_LINE is replaced by a bounded
 * `diagnostics.oversized` record. Accounting records bypass the level filter.
 */
export class DiagnosticLogger {
  private blocked = false;
  private pendingDropped = 0;
  private closed = false;
  private readonly minimum: number;
  private readonly identity: ProcessIdentity | undefined;
  private readonly totals = { written: 0, dropped: 0, truncated: 0, oversized: 0 };
  private readonly drain = () => {
    this.blocked = false;
    if (this.pendingDropped) {
      const dropped = this.pendingDropped;
      this.pendingDropped = 0;
      this.emit({
        level: 'warning',
        component: 'diagnostics',
        code: 'diagnostics.dropped',
        dropped,
      });
    }
  };
  private readonly failed = () => {
    this.blocked = true;
  };
  constructor(
    private readonly sink: Writable,
    private readonly now: () => string,
    options: DiagnosticOptions = {},
  ) {
    this.minimum = rank[options.level ?? 'info'];
    this.identity = options.process;
    sink.on('drain', this.drain);
    sink.on('error', this.failed);
  }

  enabled(level: LogLevel): boolean {
    return rank[level] >= this.minimum;
  }

  get counters(): DiagnosticCounters {
    return { ...this.totals };
  }

  write(record: DiagnosticRecord): void {
    if (this.closed || rank[record.level] < this.minimum) return;
    this.emit(record);
  }

  /** Resolves once previously accepted lines reached the sink, or after timeoutMs. */
  flush(timeoutMs = 1000): Promise<void> {
    if (this.sink.writableLength === 0 || this.sink.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref();
      try {
        // A zero-length write completes after every earlier write, preserving order.
        this.sink.write('', () => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  close(): void {
    this.closed = true;
    this.sink.off('drain', this.drain);
    this.sink.off('error', this.failed);
  }

  private emit(record: DiagnosticRecord): void {
    if (this.closed) return;
    if (this.blocked) {
      this.pendingDropped = Math.min(this.pendingDropped + 1, Number.MAX_SAFE_INTEGER);
      this.totals.dropped = Math.min(this.totals.dropped + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    const line = this.serialize(record);
    try {
      this.blocked = !this.sink.write(line + '\n');
      this.totals.written++;
    } catch {
      this.failed();
    }
  }

  private serialize(record: DiagnosticRecord): string {
    const { level, component, code, ...fields } = record;
    const timestamp = this.now();
    const head = { timestamp, level, ...this.identity, component };
    const body: Record<string, unknown> = { ...head, code: clipped(code, 128) };
    let truncated = 0;
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value === 'string') {
        const limit = name === 'reason' ? reasonLimit : textLimit;
        if (value.length > limit) truncated++;
        body[name] = clipped(value, limit);
      } else if (typeof value === 'number') body[name] = Number.isFinite(value) ? value : null;
      else if (typeof value === 'boolean') body[name] = value;
    }
    if (truncated) {
      body['truncated'] = truncated;
      this.totals.truncated++;
    }
    const line = JSON.stringify(body);
    if (line.length <= MAX_DIAGNOSTIC_LINE) return line;
    this.totals.oversized++;
    return JSON.stringify({
      ...head,
      level: 'warning',
      component: 'diagnostics',
      code: 'diagnostics.oversized',
      recordCode: clipped(code, 128),
      ...(typeof fields.requestId === 'string'
        ? { requestId: clipped(fields.requestId, 128) }
        : {}),
    });
  }
}

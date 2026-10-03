import { Writable } from 'node:stream';

const limitBytes = 1536 * 1024;

/**
 * The process log on its way to stdout, with the newest lines kept for a feedback report
 * (ADR 0060). Records are already redacted by the diagnostic logger's closed field list. The
 * copy is bounded by bytes, and a chunk completes only when the target accepted it, so the
 * logger's backpressure accounting stays the target's.
 */
export class RecentLog extends Writable {
  private readonly lines: string[] = [];
  private bytes = 0;
  private partial = '';

  constructor(private readonly target: NodeJS.WritableStream) {
    super({ decodeStrings: false });
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : '';
    this.keep(text);
    this.target.write(text, (error) => {
      callback(error ?? null);
    });
  }

  private keep(text: string): void {
    const parts = (this.partial + text).split('\n');
    this.partial = (parts.pop() ?? '').slice(-8192);
    for (const line of parts) {
      if (!line) continue;
      this.lines.push(line);
      this.bytes += Buffer.byteLength(line) + 1;
    }
    while (this.bytes > limitBytes && this.lines.length) {
      this.bytes -= Buffer.byteLength(this.lines.shift() ?? '') + 1;
    }
  }

  /** The kept lines, oldest first, as JSON lines. */
  text(): string {
    return this.lines.length ? `${this.lines.join('\n')}\n` : '';
  }
}

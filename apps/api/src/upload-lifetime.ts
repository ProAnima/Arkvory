import { Readable } from 'node:stream';
import { Socket } from 'node:net';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { BandwidthGovernor } from '@proanima/arkvory-infrastructure';
import type { resolveUploadTimeouts } from './upload-policy.js';

type TimeoutObserver = (
  request: FastifyRequest,
  code: 'upload.input_timeout' | 'upload.deadline',
) => void;

/** Covers storage/commit as well as wire I/O; bounded admission must already be held. */
export async function withUploadDeadline<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  external: AbortSignal,
  deadlineMs: number,
  action: (signal: AbortSignal) => Promise<T>,
  onDeadline: () => void,
): Promise<T> {
  external.throwIfAborted();
  const deadline = new AbortController();
  const signal = AbortSignal.any([external, deadline.signal]);
  const interrupt = () => {
    request.raw.destroy();
    reply.raw.destroy();
  };
  signal.addEventListener('abort', interrupt, { once: true });
  const timer = setTimeout(() => {
    if (signal.aborted) return;
    onDeadline();
    deadline.abort(new ArkvoryError('unavailable', 'Upload operation deadline exceeded'));
  }, deadlineMs);
  timer.unref();
  const socket = reply.raw.socket;
  const previousTimeout = socket?.timeout ?? 30_000;
  // Socket inactivity cannot distinguish an idle sender from backend/shaper backpressure.
  // In-process HTTP injection has no TCP socket; the absolute deadline still applies there.
  if (socket instanceof Socket) socket.setTimeout(0);
  try {
    const result = await action(signal);
    signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupt);
    if (socket instanceof Socket && !socket.destroyed) socket.setTimeout(previousTimeout);
  }
}

async function* inputChunks(
  stream: Readable,
  idleMs: number,
  signal: AbortSignal,
  onIdle: () => void,
) {
  const iterator = stream.iterator({ destroyOnReturn: false });
  try {
    for (;;) {
      signal.throwIfAborted();
      // Charge idle time only while asking the sender for data, never while yielding to storage.
      const timer = setTimeout(() => {
        if (signal.aborted) return;
        onIdle();
        stream.destroy(new ArkvoryError('unavailable', 'Upload input idle timeout'));
      }, idleMs);
      timer.unref();
      let item: IteratorResult<unknown>;
      try {
        item = await iterator.next();
      } finally {
        clearTimeout(timer);
      }
      signal.throwIfAborted();
      if (item.done) return;
      if (!(item.value instanceof Uint8Array))
        throw new ArkvoryError('invalid_input', 'Invalid request bytes');
      yield item.value;
    }
  } finally {
    await iterator.return?.();
  }
}

export class UploadReceiver {
  constructor(
    private readonly policy: ReturnType<typeof resolveUploadTimeouts>,
    private readonly bandwidth: Pick<BandwidthGovernor, 'stream'>,
    private readonly onTimeout: TimeoutObserver,
  ) {}

  async receive<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    owner: string,
    external: AbortSignal,
    action: (source: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const stream = request.body;
    if (!(stream instanceof Readable))
      throw new ArkvoryError('invalid_input', 'Content-Type must be application/octet-stream');
    return withUploadDeadline(
      request,
      reply,
      external,
      this.policy.uploadDeadlineMs,
      async (signal) => {
        const abort = () => {
          stream.destroy();
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          return await action(
            this.bandwidth.stream(
              inputChunks(stream, this.policy.uploadIdleTimeoutMs, signal, () => {
                this.onTimeout(request, 'upload.input_timeout');
              }),
              owner,
              signal,
            ),
            signal,
          );
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
      () => {
        this.onTimeout(request, 'upload.deadline');
      },
    );
  }
}

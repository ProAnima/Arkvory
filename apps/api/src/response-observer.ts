import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface ObservedResponse {
  readonly request: FastifyRequest;
  /** Route template, or 'unmatched' when no route was found; never the raw URL. */
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  /** Socket bytes written for this response, headers included; absent for injected requests. */
  readonly bytesSent?: number;
  /**
   * Socket bytes read since the previous response on the same connection closed (headers and
   * body of this request). Absent for injected requests.
   */
  readonly bytesReceived?: number;
  /** False when the response was aborted before it finished. */
  readonly completed: boolean;
}

function counter(socket: unknown, name: 'bytesWritten' | 'bytesRead'): number | undefined {
  // Injected requests use a socket stand-in without counters.
  if (typeof socket !== 'object' || socket === null) return undefined;
  const bytes: unknown = Reflect.get(socket, name);
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) ? bytes : undefined;
}

/**
 * Calls listener once per request when its response closes, aborted transfers included.
 * Each observer keeps its own per-socket read offset, so independent observers agree.
 */
export function observeResponses(
  app: FastifyInstance,
  now: () => number,
  listener: (observed: ObservedResponse) => void,
): void {
  const readOffsets = new WeakMap<object, number>();
  app.addHook('onRequest', (request, reply, done) => {
    const started = now();
    const socket: unknown = request.raw.socket;
    const written = counter(socket, 'bytesWritten');
    reply.raw.once('close', () => {
      const writtenAfter = counter(socket, 'bytesWritten');
      const read = counter(socket, 'bytesRead');
      let bytesReceived: number | undefined;
      if (read !== undefined && typeof socket === 'object' && socket !== null) {
        const previous = readOffsets.get(socket) ?? 0;
        if (read >= previous) bytesReceived = read - previous;
        readOffsets.set(socket, read);
      }
      listener({
        request,
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.raw.statusCode,
        durationMs: Math.max(0, now() - started),
        ...(written !== undefined && writtenAfter !== undefined && writtenAfter >= written
          ? { bytesSent: writtenAfter - written }
          : {}),
        ...(bytesReceived === undefined ? {} : { bytesReceived }),
        completed: reply.raw.writableFinished,
      });
    });
    done();
  });
}

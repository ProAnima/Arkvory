import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Principal } from '@proanima/arkvory-domain';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import { observeResponses } from './response-observer.js';
import { traceIdOf } from './request-correlation.js';

interface AccessLog {
  writer: Pick<DiagnosticLogger, 'write'>;
  principal: (request: FastifyRequest) => Principal | undefined;
  /** Monotonic milliseconds. */
  now: () => number;
}
const probes = new Set(['/health/live', '/health/status']);

/**
 * One JSON line per request when its response closes, aborted transfers included. Only the
 * route template is logged: query strings and headers can carry credentials or values.
 * Byte counts are socket deltas (headers included) and are omitted when the socket is unknown.
 */
export function registerAccessLog(app: FastifyInstance, log: AccessLog): void {
  observeResponses(app, log.now, (observed) => {
    const { request, route, status } = observed;
    // Successful public probes would dominate the log at load-balancer frequency.
    if (probes.has(route) && status < 400) return;
    const principal = log.principal(request)?.id;
    const traceId = traceIdOf(request.headers['traceparent']);
    log.writer.write({
      level: 'info',
      component: 'http',
      code: 'http.access',
      requestId: request.id,
      ...(traceId ? { traceId } : {}),
      method: request.method,
      route,
      status,
      durationMs: Math.round(observed.durationMs),
      ...(observed.bytesSent === undefined ? {} : { bytesSent: observed.bytesSent }),
      ...(observed.bytesReceived === undefined ? {} : { bytesReceived: observed.bytesReceived }),
      ...(principal ? { principal } : {}),
      clientIp: request.ip,
      completed: observed.completed,
    });
  });
}

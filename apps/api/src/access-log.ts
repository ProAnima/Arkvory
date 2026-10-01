import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Principal } from '@proanima/arkvory-domain';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';

interface AccessLog {
  writer: Pick<DiagnosticLogger, 'write'>;
  principal: (request: FastifyRequest) => Principal | undefined;
  /** Monotonic milliseconds. */
  now: () => number;
}
const probes = new Set(['/health/live', '/health/status']);

function written(request: FastifyRequest): number | undefined {
  // Injected requests use a socket stand-in without counters.
  const socket: unknown = request.raw.socket;
  if (typeof socket !== 'object' || socket === null) return undefined;
  const bytes: unknown = Reflect.get(socket, 'bytesWritten');
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) ? bytes : undefined;
}

/**
 * One JSON line per request when its response closes, aborted transfers included. Only the
 * route template is logged: query strings and headers can carry credentials or values.
 * bytesSent is the socket delta (headers included) and is omitted when the socket is unknown.
 */
export function registerAccessLog(app: FastifyInstance, log: AccessLog): void {
  app.addHook('onRequest', (request, reply, done) => {
    const started = log.now();
    const before = written(request);
    reply.raw.once('close', () => {
      const route = request.routeOptions.url ?? 'unmatched';
      const status = reply.raw.statusCode;
      // Successful public probes would dominate the log at load-balancer frequency.
      if (probes.has(route) && status < 400) return;
      const after = written(request);
      const principal = log.principal(request)?.id;
      log.writer.write({
        level: 'info',
        component: 'api',
        code: 'http.access',
        requestId: request.id,
        method: request.method,
        route,
        status,
        durationMs: Math.max(0, Math.round(log.now() - started)),
        ...(before !== undefined && after !== undefined && after >= before
          ? { bytesSent: after - before }
          : {}),
        ...(principal ? { principal } : {}),
        clientIp: request.ip,
        completed: reply.raw.writableFinished,
      });
    });
    done();
  });
}

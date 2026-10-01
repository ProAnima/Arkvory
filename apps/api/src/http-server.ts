import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';

/**
 * Client addresses come from the socket unless the peer is a configured reverse proxy; then
 * Fastify takes the nearest untrusted X-Forwarded-For hop. Login throttling depends on this.
 */
export function createHttpServer(
  options: { trustedProxies: readonly string[] } = { trustedProxies: [] },
) {
  const app = Fastify({
    logger: false,
    trustProxy: options.trustedProxies.length ? [...options.trustedProxies] : false,
    bodyLimit: 64 * 1024,
    requestTimeout: 30 * 60 * 1000,
    connectionTimeout: 30000,
    return503OnClosing: true,
    forceCloseConnections: true,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });
  return app;
}

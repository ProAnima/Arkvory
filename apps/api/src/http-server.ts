import Fastify from 'fastify';
import { requestIdGenerator } from './request-correlation.js';

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
    // X-Request-Id is accepted only from trusted proxies; Fastify's own header lookup stays off.
    genReqId: requestIdGenerator(options.trustedProxies),
    requestIdHeader: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });
  return app;
}

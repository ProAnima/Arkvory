import Fastify from 'fastify';
import { createServer as createHttpsServer } from 'node:https';
import type { Server } from 'node:http';
import type { SecureContextOptions } from 'node:tls';
import { requestIdGenerator } from './request-correlation.js';
import type { SecureServer } from './tls-material.js';

export interface HttpServerOptions {
  readonly trustedProxies: readonly string[];
  /** Built-in HTTPS; the listener keeps one type, so routes and hooks are unaware of TLS. */
  readonly tls?: SecureContextOptions;
  /** Receives the HTTPS listener so a renewed certificate can replace its secure context. */
  readonly onSecureServer?: (server: SecureServer) => void;
}

/**
 * Client addresses come from the socket unless the peer is a configured reverse proxy; then
 * Fastify takes the nearest untrusted X-Forwarded-For hop. Login throttling depends on this.
 */
export function createHttpServer(options: HttpServerOptions = { trustedProxies: [] }) {
  const tls = options.tls;
  const app = Fastify({
    ...(tls
      ? {
          serverFactory: (handler: Parameters<typeof createHttpsServer>[1]) => {
            const secure = createHttpsServer(tls, handler);
            options.onSecureServer?.(secure);
            const server: Server = secure;
            return server;
          },
        }
      : {}),
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

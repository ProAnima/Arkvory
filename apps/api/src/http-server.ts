import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';

export function createHttpServer() {
  const app = Fastify({
    logger: false,
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

import type { FastifyInstance } from 'fastify';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import type { HttpServerOptions } from './http-server.js';
import { TlsCertificateWatcher, loadTlsMaterial, secureContext } from './tls-material.js';
import type { SecureServer, TlsMaterial } from './tls-material.js';

export interface PreparedTls {
  readonly options: Pick<HttpServerOptions, 'tls' | 'onSecureServer'>;
  attach(app: FastifyInstance, diagnostics: DiagnosticLogger): TlsCertificateWatcher | undefined;
}

/**
 * Loads and validates the certificate before any resource is opened, so a bad certificate
 * fails startup instead of serving plain HTTP. HSTS is sent only by the built-in listener: a
 * proxy in front of a plain-HTTP API owns that header itself.
 */
export async function prepareTls(config: ServerConfig, now = Date.now): Promise<PreparedTls> {
  const settings = config.tls;
  if (!settings) return { options: {}, attach: () => undefined };
  const material: TlsMaterial = await loadTlsMaterial(settings, now);
  let listener: SecureServer | undefined;
  return {
    options: {
      tls: secureContext(material, settings),
      onSecureServer: (server) => {
        listener = server;
      },
    },
    attach(app, diagnostics) {
      const watcher = new TlsCertificateWatcher(
        settings,
        material,
        (record) => {
          diagnostics.write(record);
        },
        now,
      );
      app.addHook('onSend', (_request, reply, payload, done) => {
        reply.header('Strict-Transport-Security', 'max-age=31536000');
        done(null, payload);
      });
      app.addHook('onClose', (_instance, done) => {
        watcher.stop();
        done();
      });
      if (listener) watcher.start(listener);
      return watcher;
    },
  };
}

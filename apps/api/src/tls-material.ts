import { X509Certificate, createPrivateKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { SecureContextOptions } from 'node:tls';
import { failureCause } from '@proanima/arkvory-infrastructure';
import type { DiagnosticRecord } from '@proanima/arkvory-infrastructure';
import type { TlsSettings } from './tls-config.js';

const maxPemBytes = 1024 * 1024;
const messages = {
  size: 'TLS certificate and key must be PEM files up to 1 MiB',
  certificate: 'TLS certificate is not valid PEM',
  key: 'TLS key is not an unencrypted PEM private key',
  mismatch: 'TLS certificate and key do not match',
  expired: 'TLS certificate has expired',
} as const;
const known: ReadonlySet<string> = new Set(Object.values(messages));
const dayMs = 24 * 60 * 60 * 1000;
const warnBeforeMs = 14 * dayMs;

export interface TlsMaterial {
  readonly key: string;
  /** PEM leaf certificate, optionally followed by its chain. */
  readonly cert: string;
  readonly fingerprint: string;
  readonly notAfterMs: number;
}

async function pem(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxPemBytes) throw new Error(messages.size);
  return readFile(path, 'utf8');
}

function parse<T>(read: () => T, message: string): T {
  try {
    return read();
  } catch {
    throw new Error(message);
  }
}

/** Rejects unreadable, mismatched or already expired material before it can replace anything. */
export async function loadTlsMaterial(settings: TlsSettings, now: () => number) {
  const [cert, key] = await Promise.all([pem(settings.certificateFile), pem(settings.keyFile)]);
  const certificate = parse(() => new X509Certificate(cert), messages.certificate);
  const privateKey: KeyObject = parse(() => createPrivateKey(key), messages.key);
  if (!certificate.checkPrivateKey(privateKey)) throw new Error(messages.mismatch);
  const notAfterMs = certificate.validToDate.getTime();
  if (!Number.isFinite(notAfterMs) || notAfterMs <= now()) throw new Error(messages.expired);
  return { key, cert, fingerprint: certificate.fingerprint256, notAfterMs } satisfies TlsMaterial;
}

export function secureContext(material: TlsMaterial, settings: TlsSettings): SecureContextOptions {
  return { key: material.key, cert: material.cert, minVersion: settings.minVersion };
}

export interface SecureServer {
  setSecureContext(options: SecureContextOptions): void;
}

/**
 * Renewed certificates (ACME, corporate PKI) are picked up by polling the files: watchers are
 * unreliable on network shares. New connections use the new context; open ones keep theirs. A
 * broken renewal never replaces the working certificate and is logged until fixed.
 */
export class TlsCertificateWatcher {
  private timer: NodeJS.Timeout | undefined;
  private warnedAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | undefined;

  constructor(
    private readonly settings: TlsSettings,
    private current: TlsMaterial,
    private readonly log: (record: DiagnosticRecord) => void,
    private readonly now: () => number,
  ) {}

  get notAfterMs() {
    return this.current.notAfterMs;
  }

  start(server: SecureServer): void {
    this.warnIfExpiring();
    if (this.settings.reloadSeconds === 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.check(server);
    }, this.settings.reloadSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Single-flight; exposed so operators' tooling and tests can force an immediate check. */
  check(server: SecureServer): Promise<void> {
    this.running ??= this.reload(server).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async reload(server: SecureServer): Promise<void> {
    try {
      const next = await loadTlsMaterial(this.settings, this.now);
      if (next.fingerprint !== this.current.fingerprint || next.key !== this.current.key) {
        server.setSecureContext(secureContext(next, this.settings));
        this.current = next;
        this.log({
          level: 'info',
          component: 'process',
          code: 'tls.reloaded',
          notAfter: new Date(next.notAfterMs).toISOString(),
        });
      }
    } catch (error) {
      this.log({
        level: 'error',
        component: 'process',
        code: 'tls.reload_failed',
        // File system errors carry paths; only the constant validation reasons are logged.
        reason:
          error instanceof Error && known.has(error.message)
            ? error.message
            : 'certificate files unreadable',
        ...failureCause(error),
      });
    }
    this.warnIfExpiring();
  }

  private warnIfExpiring(): void {
    const left = this.current.notAfterMs - this.now();
    if (left > warnBeforeMs || this.now() - this.warnedAt < dayMs) return;
    this.warnedAt = this.now();
    this.log({
      level: 'warning',
      component: 'process',
      code: 'tls.expiring',
      notAfter: new Date(this.current.notAfterMs).toISOString(),
      daysLeft: Math.max(0, Math.floor(left / dayMs)),
    });
  }
}

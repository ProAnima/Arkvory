export type TlsVersion = 'TLSv1.2' | 'TLSv1.3';

export interface TlsSettings {
  readonly certificateFile: string;
  readonly keyFile: string;
  readonly minVersion: TlsVersion;
  /** Polling interval for renewed certificate files; 0 keeps the startup certificate. */
  readonly reloadSeconds: number;
}

const versions: readonly TlsVersion[] = ['TLSv1.2', 'TLSv1.3'];

function isVersion(value: string): value is TlsVersion {
  return versions.some((version) => version === value);
}

/**
 * Built-in HTTPS is optional: without both files the API serves plain HTTP for loopback or a
 * TLS-terminating reverse proxy. One file without the other is a configuration error, never a
 * silent downgrade to HTTP.
 */
export function readTls(env: NodeJS.ProcessEnv): { tls?: TlsSettings } {
  const certificateFile = env['ARKVORY_TLS_CERT_FILE']?.trim() ?? '';
  const keyFile = env['ARKVORY_TLS_KEY_FILE']?.trim() ?? '';
  if (!certificateFile && !keyFile) return {};
  if (!certificateFile || !keyFile)
    throw new Error('ARKVORY_TLS_CERT_FILE and ARKVORY_TLS_KEY_FILE must be set together');
  const minVersion = env['ARKVORY_TLS_MIN_VERSION']?.trim() || 'TLSv1.2';
  if (!isVersion(minVersion)) throw new Error('ARKVORY_TLS_MIN_VERSION must be TLSv1.2 or TLSv1.3');
  const reload = env['ARKVORY_TLS_RELOAD_SECONDS']?.trim() || '300';
  if (!/^\d{1,5}$/.test(reload))
    throw new Error('ARKVORY_TLS_RELOAD_SECONDS must be 0 or 30-86400');
  const reloadSeconds = Number(reload);
  if (reloadSeconds !== 0 && (reloadSeconds < 30 || reloadSeconds > 86400))
    throw new Error('ARKVORY_TLS_RELOAD_SECONDS must be 0 or 30-86400');
  return { tls: { certificateFile, keyFile, minVersion, reloadSeconds } };
}

/** Loopback listeners need no TLS; anything else in plain HTTP should sit behind a proxy. */
export function plaintextExposed(host: string, tls: boolean, trustedProxies: readonly string[]) {
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  return !tls && !loopback && trustedProxies.length === 0;
}

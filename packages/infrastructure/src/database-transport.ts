/**
 * Whether a PostgreSQL connection URL sends the catalog over the network without TLS.
 * `pg` enables TLS from `sslmode` (require, verify-ca and verify-full all verify the server
 * certificate) or `ssl=true`; absent, `disable` and `allow` keep the link in clear text. Loopback
 * and Unix sockets never leave the host. The URL carries the password, so only the verdict is
 * returned and it is never logged or echoed.
 */
export function databasePlaintextExposed(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const socketHost = url.searchParams.get('host') ?? '';
  const host = (socketHost || url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  // An empty host or a path selects a Unix socket; libpq lists of hosts are not inspected.
  if (!host || host.startsWith('/') || host.includes(',')) return false;
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return false;
  const mode = (url.searchParams.get('sslmode') ?? '').toLowerCase();
  const flag = (url.searchParams.get('ssl') ?? '').toLowerCase();
  if (mode === 'disable' || mode === 'allow') return true;
  if (mode) return false;
  return flag !== 'true' && flag !== '1';
}

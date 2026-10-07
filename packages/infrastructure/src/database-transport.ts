/**
 * The catalog database of a Compose installation exactly as `arkvory init` writes it
 * (apps/deploy/src/initialize.ts: `postgresql://arkvory:…@database:5432/arkvory`). `database` is
 * the bundled service of deploy/compose.yml: it publishes no port and is reached over the
 * project's bridge network between two containers of the same host, so the link never leaves
 * the machine. Only this exact name, port, user and database qualify; any other single-label host
 * may be a remote server found through a DNS search domain and is judged like any other.
 */
function bundledComposeDatabase(url: URL): boolean {
  return (
    url.hostname === 'database' &&
    url.port === '5432' &&
    url.username === 'arkvory' &&
    url.pathname === '/arkvory'
  );
}

/** `PGSSLMODE` values with which `pg` opens TLS when the URL names no TLS setting at all. */
const environmentTlsModes = new Set(['prefer', 'require', 'verify-ca', 'verify-full', 'no-verify']);

/**
 * Whether a PostgreSQL connection URL sends the catalog over the network without TLS, decided as
 * `pg` (pg-connection-string) decides it. Any `sslmode` except `disable` turns TLS on (`allow` and
 * `prefer` included: pg has no clear-text fallback), and so does `sslcert`, `sslkey` or
 * `sslrootcert`. Otherwise `ssl=true`/`ssl=1` turns it on and any other `ssl` value off; without
 * `ssl`, `sslnegotiation=direct` turns it on, and without that pg reads `PGSSLMODE` from the
 * environment. Loopback, Unix sockets and the bundled Compose database never leave the host. The
 * URL carries the password, so only the verdict is returned and it is never logged or echoed.
 */
export function databasePlaintextExposed(
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const parameters = url.searchParams;
  const socketHost = parameters.get('host') ?? '';
  const host = (socketHost || url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  // An empty host or a path selects a Unix socket; libpq lists of hosts are not inspected.
  if (!host || host.startsWith('/') || host.includes(',')) return false;
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return false;
  if (!socketHost && bundledComposeDatabase(url)) return false;
  // pg compares these values case-sensitively; an empty value counts as absent, as in pg.
  const mode = parameters.get('sslmode') ?? '';
  if (mode === 'disable') return true;
  const files = ['sslcert', 'sslkey', 'sslrootcert'].some((name) => parameters.get(name));
  if (mode || files) return false;
  const flag = parameters.get('ssl');
  if (flag !== null) return flag !== 'true' && flag !== '1';
  if (parameters.get('sslnegotiation') === 'direct') return false;
  return !environmentTlsModes.has(environment['PGSSLMODE'] ?? '');
}

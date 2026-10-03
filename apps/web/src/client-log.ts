/**
 * The console's own log for feedback reports (ADR 0060): errors, warnings and failed API
 * requests of this page, the newest 300, held only in this tab's memory. Bearer credentials and
 * long secret-like strings are masked when recorded; request IDs (UUIDs) stay, they are what
 * support looks up. The report shows this text before anything is sent.
 */
const limit = 300;
const entries: string[] = [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redact(text: string): string {
  return (
    text
      .replace(/(Bearer\s+)[^\s"',]+/gi, '$1[redacted]')
      .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
      // No `/` in the class: request paths stay readable; UUIDs (request ids) stay as they are.
      .replace(/[A-Za-z0-9_\-+=]{32,}/g, (match) => (uuid.test(match) ? match : '[redacted]'))
  );
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function record(level: 'error' | 'warning' | 'request', text: string): void {
  entries.push(`${new Date().toISOString()} ${level} ${redact(text).slice(0, 1000)}`);
  if (entries.length > limit) entries.shift();
}

export function clientLogCount(): number {
  return entries.length;
}

/** The report's console log: the page's context, then the entries, oldest first. */
export function clientLogText(): string {
  const head = [
    `Arkvory console ${location.origin}${location.pathname}`,
    `user agent: ${navigator.userAgent}`,
    `language: ${navigator.language}; viewport: ${String(innerWidth)}x${String(innerHeight)}`,
  ];
  return [...head, '', ...entries].join('\n') + '\n';
}

let installed = false;
/** Installed once, before the console starts, so early failures are kept as well. */
export function installClientLog(): void {
  if (installed) return;
  installed = true;
  for (const [method, level] of [
    ['error', 'error'],
    ['warn', 'warning'],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      record(level, args.map(describe).join(' '));
      original(...args);
    };
  }
  addEventListener('error', (event) => {
    record('error', `${event.message} (${event.filename}:${String(event.lineno)})`);
  });
  addEventListener('unhandledrejection', (event) => {
    record('error', `unhandled: ${describe(event.reason)}`);
  });
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  // Method and address only: building a Request here would take an upload's body stream.
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, location.href);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const api = url.origin === location.origin && url.pathname.startsWith('/api/');
    try {
      const response = await fetchOriginal(input, init);
      if (api && response.status >= 400)
        record(
          'request',
          `${method} ${url.pathname} ${String(response.status)} request ${response.headers.get('x-request-id') ?? '-'}`,
        );
      return response;
    } catch (error) {
      if (api) record('request', `${method} ${url.pathname} failed: ${describe(error)}`);
      throw error;
    }
  };
}

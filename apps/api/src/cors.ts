import type { FastifyInstance } from 'fastify';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] as const;
const headers = [
  'authorization',
  'content-type',
  'idempotency-key',
  'x-content-sha256',
  'range',
  'if-range',
  'if-none-match',
] as const;
const exposed = [
  'X-Request-Id',
  'ETag',
  'Content-Length',
  'Content-Range',
  'Accept-Ranges',
  'Content-Disposition',
  'Location',
  'Retry-After',
] as const;

export function parseCorsOrigins(value: unknown): readonly string[] {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Invalid CORS origins');
  const entries: readonly unknown[] = typeof value === 'string' ? value.split(',') : value;
  if (entries.length > 16) throw new Error('Invalid CORS origins');
  const origins = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length > 256) throw new Error('Invalid CORS origin');
    const input = entry.trim();
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error('Invalid CORS origin');
    }
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new Error('CORS origins require HTTPS or loopback HTTP');
    origins.add(url.origin);
  }
  return [...origins];
}

function isNativePath(url: string): boolean {
  return url.startsWith('/api/v1/') || url === '/health/ready' || url.startsWith('/health/ready?');
}

function isOwnOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const supplied = new URL(origin);
    return (
      supplied.origin === origin && new URL(`${supplied.protocol}//${host}`).host === supplied.host
    );
  } catch {
    return false;
  }
}

export function registerCors(app: FastifyInstance, origins: readonly string[]): void {
  const allowed = new Set(parseCorsOrigins(origins));
  app.addHook('onRequest', async (request, reply) => {
    if (!isNativePath(request.url) || request.headers.origin === undefined) return;
    if (
      typeof request.headers.origin === 'string' &&
      isOwnOrigin(request.headers.origin, request.headers.host)
    )
      return;
    reply
      .header('X-Request-Id', request.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      await reply.code(403).send({
        code: 'forbidden',
        message: 'Origin is not allowed',
        requestId: request.id,
      });
      return;
    }
    reply
      .header('Access-Control-Allow-Origin', origin)
      .header('Access-Control-Expose-Headers', exposed.join(', '))
      .header('Vary', 'Origin');
    if (request.method !== 'OPTIONS') return;
    const method = request.headers['access-control-request-method'];
    const requested = request.headers['access-control-request-headers'];
    const requestedHeaders = typeof requested === 'string' && requested ? requested.split(',') : [];
    if (
      typeof method !== 'string' ||
      !methods.some((item) => item === method) ||
      (requested !== undefined &&
        (typeof requested !== 'string' ||
          requestedHeaders.some(
            (item) => !headers.some((header) => header === item.trim().toLowerCase()),
          )))
    ) {
      await reply.code(400).send({
        code: 'invalid_input',
        message: 'Unsupported CORS preflight',
        requestId: request.id,
      });
      return;
    }
    await reply
      .code(204)
      .header('Access-Control-Allow-Methods', methods.join(', '))
      .header('Access-Control-Allow-Headers', headers.join(', '))
      .header('Access-Control-Max-Age', '600')
      .header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
      .send();
  });
}

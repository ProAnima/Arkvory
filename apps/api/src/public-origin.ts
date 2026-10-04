import type { FastifyRequest } from 'fastify';

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * The origin clients use, for absolute links in protocol answers (Git LFS actions, npm tarball
 * URLs). Behind a TLS-terminating proxy that is not in ARKVORY_TRUSTED_PROXIES, Fastify reports
 * http although the client spoke https. X-Forwarded-Proto may therefore upgrade the scheme to
 * https, never downgrade it: a forged header can only make a link stricter. `secure` is false
 * for a plain-HTTP link to another host; such a link must not carry the client's credential.
 */
export function publicOrigin(request: FastifyRequest): { origin: string; secure: boolean } {
  const forwarded = request.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const scheme = request.protocol === 'https' || first === 'https' ? 'https' : 'http';
  const origin = `${scheme}://${request.host}`;
  return { origin, secure: scheme === 'https' || loopback.has(new URL(origin).hostname) };
}

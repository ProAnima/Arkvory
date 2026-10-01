import { BlockList, isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Accepted inbound IDs: bounded and printable, without separators that could split fields. */
export const inboundRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
// W3C Trace Context: lowercase hex; later versions may append "-" and printable fields.
const traceparent = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-[\x20-\x7e]*)?$/;
const mappedIPv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Same semantics as Fastify trustProxy for exact addresses and CIDR ranges. */
export function trustedPeerMatcher(
  entries: readonly string[],
): (address: string | undefined) => boolean {
  if (entries.length === 0) return () => false;
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error('Invalid trusted proxy entry');
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  return (address) => {
    if (!address) return false;
    // A dual-stack listener reports IPv4 peers as ::ffff:a.b.c.d.
    const candidate = mappedIPv4.exec(address)?.[1] ?? address;
    const family = isIP(candidate);
    return family !== 0 && list.check(candidate, family === 6 ? 'ipv6' : 'ipv4');
  };
}

/**
 * A request ID is the server's correlation key (error bodies, access log, jobs, audit). An
 * inbound X-Request-Id is honoured only from a configured reverse proxy and only when it is a
 * single value matching inboundRequestId; anything else is replaced, never echoed.
 */
export function requestIdGenerator(
  trustedProxies: readonly string[],
  generate: () => string = randomUUID,
): (request: IncomingMessage) => string {
  const trusted = trustedPeerMatcher(trustedProxies);
  return (request) => {
    const inbound = request.headers['x-request-id'];
    if (
      typeof inbound === 'string' &&
      inboundRequestId.test(inbound) &&
      trusted(request.socket.remoteAddress)
    )
      return inbound;
    return generate();
  };
}

/**
 * Trace ID of a valid W3C traceparent, from any peer: it is caller-supplied context for log
 * correlation only, never an identity or authorization input. Invalid headers yield undefined.
 */
export function traceIdOf(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.length > 512) return undefined;
  const match = traceparent.exec(header);
  if (!match) return undefined;
  const [, version = '', traceId = '', parentId = '', , extension] = match;
  if (version === 'ff' || (version === '00' && extension !== undefined)) return undefined;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return undefined;
  return traceId;
}

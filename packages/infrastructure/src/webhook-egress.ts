import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { WebhookFailure } from '@proanima/arkvory-application';

/** Where a receiver name resolved to, already checked against the egress policy. */
export interface ResolvedReceiver {
  readonly address: string;
  readonly family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedReceiver[]>;

/**
 * Address ranges a webhook never reaches by default: loopback, link-local (cloud metadata is
 * 169.254.169.254), private, shared, documentation, multicast, reserved, and the IPv6 forms that
 * carry an IPv4 address (mapped, NAT64, 6to4, Teredo), which could smuggle a blocked target.
 */
function deniedRanges(): BlockList {
  const list = new BlockList();
  for (const [address, bits] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const)
    list.addSubnet(address, bits, 'ipv4');
  for (const [address, bits] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ] as const)
    list.addSubnet(address, bits, 'ipv6');
  return list;
}

/**
 * Addresses that embed an IPv4 one (`::ffff:a.b.c.d`). Kept apart: node checks an IPv4 address
 * against IPv6 subnets too, so this range in the main list would block every IPv4 address.
 */
function mappedRange(): BlockList {
  const list = new BlockList();
  list.addSubnet('::ffff:0:0', 96, 'ipv6');
  return list;
}

export interface EgressPolicy {
  /** Whether a request to this address may leave the server. */
  permits(address: string, family: 4 | 6): boolean;
}

/**
 * The egress policy of webhooks (ADR 0069). Public addresses pass; the operator adds networks
 * with `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`. A plain-HTTP receiver on a loopback host is the one
 * other exception, decided by the caller through `loopbackReceiver`.
 */
export function createEgressPolicy(allowed: readonly string[]): EgressPolicy {
  const denied = deniedRanges();
  const mapped = mappedRange();
  const permitted = new BlockList();
  for (const network of allowed) {
    const [address = '', prefix = ''] = network.split('/');
    permitted.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return {
    permits: (address, family) => {
      const type = family === 4 ? 'ipv4' : 'ipv6';
      if (permitted.check(address, type)) return true;
      return !denied.check(address, type) && !(family === 6 && mapped.check(address, type));
    },
  };
}

/** Every address of the name, in the order the system resolver returns them. */
export const systemResolver: Resolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
};

/** A plain-HTTP receiver on a loopback host (the one case config accepts) is reached as it is. */
export function loopbackReceiver(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

/**
 * Resolves the receiver once and checks every address before any connection: one blocked record
 * refuses the delivery, so a name that mixes public and internal addresses cannot pick the
 * internal one later. The caller connects to the returned address, not to the name, so a DNS
 * answer that changes between check and connect gains nothing.
 */
export async function resolveReceiver(
  url: URL,
  policy: EgressPolicy,
  resolve: Resolver = systemResolver,
): Promise<ResolvedReceiver> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  let records: readonly ResolvedReceiver[];
  if (literal === 4 || literal === 6) records = [{ address: host, family: literal }];
  else {
    try {
      records = await resolve(host);
    } catch {
      throw new WebhookFailure('network');
    }
  }
  const first = records[0];
  if (first === undefined) throw new WebhookFailure('network');
  if (loopbackReceiver(url)) return first;
  if (records.some((record) => !policy.permits(record.address, record.family)))
    throw new WebhookFailure('blocked');
  return first;
}

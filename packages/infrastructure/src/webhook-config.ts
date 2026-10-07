import { readFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { getCACertificates } from 'node:tls';

/** One webhook subscription of this installation (ADR 0069). */
export interface WebhookSettings {
  /** Stable name of the subscription: its cursor and its metric label. */
  readonly id: string;
  /** Local repository whose change feed is delivered. */
  readonly repository: string;
  /** Receiver. HTTPS; plain HTTP only to a loopback host. No credentials, query or fragment. */
  readonly url: string;
  /** File with the signing secret; read by the worker only, never logged. */
  readonly secretFile: string;
  /** A second secret for a rotation: every delivery then carries both signatures. */
  readonly nextSecretFile?: string;
  /** Feed actions to deliver (for example `artifact.publish`); absent means all. */
  readonly actions?: readonly string[];
}

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const actionPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const maxWebhooks = 16;

function fail(field: string): never {
  throw new Error(`Invalid ARKVORY_WEBHOOKS_FILE: ${field}`);
}

function receiver(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) fail('url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('url');
  }
  // The signature is no secrecy: plain HTTP carries every event in clear text, so only loopback.
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) fail('url');
  return url.href;
}

function file(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.length > 1024 ||
    value.includes('\0')
  )
    fail(field);
  return value;
}

function actions(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) fail('actions');
  const list: readonly unknown[] = value;
  const parsed = list.map((action) => {
    if (typeof action !== 'string' || !actionPattern.test(action)) fail('actions');
    return action;
  });
  if (new Set(parsed).size !== parsed.length) fail('actions');
  return parsed;
}

function entry(value: unknown): WebhookSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('webhook');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const known = ['id', 'repository', 'url', 'secretFile', 'nextSecretFile', 'actions'];
  if (Object.keys(row).some((key) => !known.includes(key))) fail('unknown field');
  const { id, repository } = row;
  if (typeof id !== 'string' || !idPattern.test(id)) fail('id');
  if (typeof repository !== 'string' || !repositoryPattern.test(repository)) fail('repository');
  return {
    id,
    repository,
    url: receiver(row['url']),
    secretFile: file(row['secretFile'], 'secretFile'),
    ...(row['nextSecretFile'] === undefined
      ? {}
      : { nextSecretFile: file(row['nextSecretFile'], 'nextSecretFile') }),
    ...(row['actions'] === undefined ? {} : { actions: actions(row['actions']) }),
  };
}

/** `{ "webhooks": [...] }`; ids are unique, at most 16 subscriptions per installation. */
export function parseWebhookSettings(value: unknown): readonly WebhookSettings[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('document');
  const document: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(document).some((key) => key !== 'webhooks')) fail('unknown field');
  const list = document['webhooks'];
  if (!Array.isArray(list) || list.length > maxWebhooks) fail('webhooks');
  const entries: readonly unknown[] = list;
  const webhooks = entries.map(entry);
  if (new Set(webhooks.map((webhook) => webhook.id)).size !== webhooks.length) fail('duplicate id');
  return webhooks;
}

/** No file configured means no webhooks; a configured but unreadable file stops startup. */
export async function readWebhookSettings(
  path: string | undefined,
): Promise<readonly WebhookSettings[]> {
  if (path === undefined || path === '') return [];
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error('ARKVORY_WEBHOOKS_FILE cannot be read', { cause: error });
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid ARKVORY_WEBHOOKS_FILE: JSON', { cause: error });
  }
  return parseWebhookSettings(document);
}

/**
 * Certificate authorities for receivers: the defaults of this process plus the PEM file of
 * `ARKVORY_WEBHOOKS_CA_FILE` (a corporate CA of an internal receiver). Passed as `ca`, which
 * replaces the store of a request, hence the defaults are included. Absent: undefined, so the
 * request keeps its default store. TLS verification itself is never relaxed.
 */
export async function readWebhookCertificates(
  path: string | undefined,
): Promise<readonly string[] | undefined> {
  if (path === undefined || path === '') return undefined;
  if (!isAbsolute(path)) throw new Error('Invalid ARKVORY_WEBHOOKS_CA_FILE');
  const blocks =
    (await readFile(path, 'utf8')).match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ) ?? [];
  if (blocks.length === 0) throw new Error('ARKVORY_WEBHOOKS_CA_FILE holds no certificates');
  return [...getCACertificates('default'), ...blocks];
}

/**
 * Networks the operator allows as receivers besides public addresses
 * (`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`, comma-separated CIDR such as `10.20.0.0/16`). Absent: none.
 */
export function parseAllowedNetworks(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return [];
  const networks = value.split(',').map((part) => part.trim());
  if (networks.length > 32) throw new Error('Invalid ARKVORY_WEBHOOKS_ALLOW_PRIVATE');
  for (const network of networks) {
    const [address, prefix, extra] = network.split('/');
    const family = address === undefined ? 0 : isIP(address);
    const bits = prefix !== undefined && /^[0-9]{1,3}$/.test(prefix) ? Number(prefix) : -1;
    if (extra !== undefined || family === 0 || bits < 0 || bits > (family === 4 ? 32 : 128))
      throw new Error('Invalid ARKVORY_WEBHOOKS_ALLOW_PRIVATE');
    // Constructing the list is the check: node rejects an address it cannot place in a subnet.
    new BlockList().addSubnet(address ?? '', bits, family === 4 ? 'ipv4' : 'ipv6');
  }
  return networks;
}

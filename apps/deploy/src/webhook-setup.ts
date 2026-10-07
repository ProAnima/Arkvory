import { chown, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { atomicText, replaceText } from './files.js';
import type { Installation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import type { ServiceControl } from './tls-setup.js';
import { mergeCertificates, sourceCertificates } from './mirror-ca.js';

/** `arkvory configure --webhook …` (ADR 0069): one subscription per call. */
export interface WebhookChange {
  /** Name of the subscription to add or to replace. */
  readonly id?: string;
  readonly repository?: string;
  readonly url?: string;
  /** File with the signing secret; copied under config/webhooks, never logged. */
  readonly secretFile?: string;
  /** A second secret for a rotation: absent on a replace ends the rotation. */
  readonly nextSecretFile?: string;
  readonly actions?: readonly string[];
  /** Networks (CIDR, comma-separated) the receivers may be in besides public addresses. */
  readonly allowPrivate?: string;
  /** PEM with the authority of receivers (corporate or self-signed), merged into the bundle. */
  readonly caFile?: string;
  /** Removes a subscription; its position is forgotten by the worker. */
  readonly detach?: string;
}
interface WebhookEntry {
  id: string;
  repository: string;
  url: string;
  secretFile: string;
  nextSecretFile?: string;
  actions?: readonly string[];
}

export const webhooksOverrideFile = 'config/compose.webhooks.yml';
const namePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const actionPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const containerDirectory = '/run/arkvory/webhooks';
const maxWebhooks = 16;

function name(value: string | undefined, option: string): string {
  if (!value || !namePattern.test(value)) throw new Error(`Invalid --${option}`);
  return value;
}

/** Same rule as the worker: HTTPS, plain HTTP only to a loopback host, nothing but a path. */
export function receiverUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('--webhook-url must be an https:// URL');
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname));
  if (!secure || url.search || url.hash || url.username || url.password || url.href.length > 2048)
    throw new Error('--webhook-url must be an https:// URL without credentials, query or fragment');
  return url.href;
}

function actionList(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const valid = value.every((action) => actionPattern.test(action));
  if (!valid || value.length === 0 || value.length > 32 || new Set(value).size !== value.length)
    throw new Error('--webhook-actions lists 1 to 32 distinct feed actions');
  return value;
}

/** CIDR list of the worker's ARKVORY_WEBHOOKS_ALLOW_PRIVATE; node rejects what cannot be a subnet. */
export function allowedNetworks(value: string): string {
  const networks = value.split(',').map((part) => part.trim());
  if (networks.length > 32) throw new Error('--webhook-allow-private lists at most 32 networks');
  for (const network of networks) {
    const [address = '', prefix, extra] = network.split('/');
    const family = isIP(address);
    const bits = prefix !== undefined && /^[0-9]{1,3}$/.test(prefix) ? Number(prefix) : -1;
    if (extra !== undefined || family === 0 || bits < 0 || bits > (family === 4 ? 32 : 128))
      throw new Error('--webhook-allow-private lists CIDR networks such as 10.20.0.0/16');
    new BlockList().addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6');
  }
  return networks.join(',');
}

async function secretOf(file: string | undefined, option: string): Promise<string> {
  if (!file || !isAbsolute(file)) throw new Error(`--${option} must be an absolute path`);
  const info = await stat(file);
  if (!info.isFile() || info.size > 4096) throw new Error(`--${option} is not a secret file`);
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[\x21-\x7e]{16,4000}$/.test(value))
    throw new Error(`--${option} must hold a secret of at least 16 printable characters`);
  return value;
}

interface Layout {
  readonly directory: string;
  readonly webhooks: string;
  readonly ca: string;
  readonly runtime: string;
  readonly override: string;
  /** Paths as the worker reads them (Compose: inside the container). */
  readonly seen: (file: string) => string;
}
function layout(root: string, state: Installation): Layout {
  const directory = join(root, 'config/webhooks');
  return {
    directory,
    webhooks: join(directory, 'webhooks.json'),
    ca: join(directory, 'ca.pem'),
    runtime: join(root, 'config/runtime.json'),
    override: join(root, webhooksOverrideFile),
    seen: (file) =>
      state.mode === 'compose' ? `${containerDirectory}/${file}` : join(directory, file),
  };
}

async function optional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function entries(text: string | null): WebhookEntry[] {
  if (text === null) return [];
  const document: unknown = JSON.parse(text);
  const list =
    typeof document === 'object' && document !== null && 'webhooks' in document
      ? document.webhooks
      : null;
  if (!Array.isArray(list)) throw new Error('config/webhooks/webhooks.json is not a webhooks file');
  const items: readonly unknown[] = list;
  return items.map((item) => {
    const row: Record<string, unknown> =
      typeof item === 'object' && item !== null ? Object.fromEntries(Object.entries(item)) : {};
    const { id, repository, url, secretFile, nextSecretFile } = row;
    if (
      typeof id !== 'string' ||
      typeof repository !== 'string' ||
      typeof url !== 'string' ||
      typeof secretFile !== 'string'
    )
      throw new Error('config/webhooks/webhooks.json has an invalid entry');
    const raw: unknown = row['actions'];
    const listed: readonly unknown[] = Array.isArray(raw) ? raw : [];
    const actions = listed.filter((action): action is string => typeof action === 'string');
    return {
      id,
      repository,
      url,
      secretFile,
      ...(typeof nextSecretFile === 'string' ? { nextSecretFile } : {}),
      ...(actions.length > 0 ? { actions } : {}),
    };
  });
}

/** Owned like runtime.json: root:arkvory 0640 for systemd, readable by the container for Compose. */
async function write(
  path: string,
  value: string,
  owner: { uid: number; gid: number },
  mode: number,
) {
  await atomicText(path, value, mode);
  if (process.platform !== 'win32') await chown(path, owner.uid, owner.gid);
}

/** The worker is the only reader, so only it gets the directory. */
function override(): string {
  return [
    '# Generated by arkvory configure --webhook. Removed when the last subscription is detached.',
    'services:',
    '  worker:',
    '    volumes:',
    `      - ./config/webhooks:${containerDirectory}:ro`,
    '',
  ].join('\n');
}

/** Files a call may change, with their text before it (null: the file did not exist). */
type Snapshot = ReadonlyMap<string, string | null>;

/** runtime.json keeps its owner and mode (replaceText); the other files were created by this call. */
async function restore(snapshot: Snapshot, runtime: string) {
  for (const [path, text] of snapshot)
    if (path === runtime && text !== null) await replaceText(path, text);
    else if (text === null) await unlink(path).catch(() => undefined);
    else await atomicText(path, text, 0o600).catch(() => undefined);
}

interface Plan {
  readonly next: WebhookEntry[];
  /** Secret files to write: file name inside the directory, content. */
  readonly secrets: ReadonlyMap<string, string>;
  /** Secret files that no longer belong to a subscription. */
  readonly drop: readonly string[];
  readonly bundle: string | null;
  readonly allowPrivate: string | undefined;
}

async function planAttach(
  change: WebhookChange,
  current: WebhookEntry[],
  paths: Layout,
  bundle: string | null,
): Promise<Plan> {
  const id = name(change.id, 'webhook');
  const repository = name(change.repository, 'webhook-repository');
  const url = receiverUrl(change.url);
  const actions = actionList(change.actions);
  const secrets = new Map<string, string>([
    [`${id}.secret`, await secretOf(change.secretFile, 'webhook-secret-file')],
  ]);
  const drop: string[] = [];
  if (change.nextSecretFile) {
    const next = await secretOf(change.nextSecretFile, 'webhook-next-secret-file');
    if (next === secrets.get(`${id}.secret`))
      throw new Error('--webhook-next-secret-file must differ from --webhook-secret-file');
    secrets.set(`${id}.next-secret`, next);
  } else drop.push(`${id}.next-secret`);
  const others = current.filter((entry) => entry.id !== id);
  if (others.length >= maxWebhooks)
    throw new Error(`At most ${String(maxWebhooks)} webhook subscriptions are allowed`);
  const entry: WebhookEntry = {
    id,
    repository,
    url,
    secretFile: paths.seen(`${id}.secret`),
    ...(change.nextSecretFile ? { nextSecretFile: paths.seen(`${id}.next-secret`) } : {}),
    ...(actions ? { actions } : {}),
  };
  return {
    next: [...others, entry],
    secrets,
    drop,
    bundle: change.caFile
      ? mergeCertificates(
          bundle,
          await sourceCertificates(change.caFile, Date.now(), '--webhook-ca-file'),
        )
      : bundle,
    allowPrivate:
      change.allowPrivate === undefined ? undefined : allowedNetworks(change.allowPrivate),
  };
}

function planDetach(change: WebhookChange, current: WebhookEntry[], bundle: string | null): Plan {
  const id = name(change.detach, 'webhook-detach');
  if (!current.some((entry) => entry.id === id))
    throw new Error(`${id} is not a webhook subscription`);
  return {
    next: current.filter((entry) => entry.id !== id),
    secrets: new Map(),
    drop: [`${id}.secret`, `${id}.next-secret`],
    bundle,
    allowPrivate: undefined,
  };
}

/**
 * Adds or replaces a webhook subscription, or removes one, then restarts the services and
 * requires readiness. The secret files are checked before anything changes and copied under
 * config/webhooks; the receiver is not contacted. Any failure restores runtime.json, the
 * subscription file, the secrets and the Compose override and restarts with them.
 */
export async function configureWebhook(
  root: string,
  state: Installation,
  change: WebhookChange,
  services: ServiceControl,
): Promise<'attached' | 'detached'> {
  const paths = layout(root, state);
  const runtime = await readFile(paths.runtime, 'utf8');
  const stored = await optional(paths.webhooks);
  const bundle = await optional(paths.ca);
  const current = entries(stored);
  const plan = change.detach
    ? planDetach(change, current, bundle)
    : await planAttach(change, current, paths, bundle);
  const owner = await stat(paths.runtime);
  const mode = state.mode === 'compose' ? 0o644 : 0o640;
  const env = runtimeEnvironment(JSON.parse(runtime));
  // The settings that serve every subscription go with the last one.
  const last = plan.next.length === 0;
  const bundleAfter = last ? null : plan.bundle;
  if (last) delete env['ARKVORY_WEBHOOKS_FILE'];
  else env['ARKVORY_WEBHOOKS_FILE'] = paths.seen('webhooks.json');
  if (last) delete env['ARKVORY_WEBHOOKS_ALLOW_PRIVATE'];
  else if (plan.allowPrivate !== undefined)
    env['ARKVORY_WEBHOOKS_ALLOW_PRIVATE'] = plan.allowPrivate;
  if (bundleAfter === null) delete env['ARKVORY_WEBHOOKS_CA_FILE'];
  else env['ARKVORY_WEBHOOKS_CA_FILE'] = paths.seen('ca.pem');
  const touched = [
    paths.runtime,
    paths.webhooks,
    paths.ca,
    paths.override,
    ...[...plan.secrets.keys(), ...plan.drop].map((file) => join(paths.directory, file)),
  ];
  const snapshot: Snapshot = new Map(
    await Promise.all(touched.map(async (path) => [path, await optional(path)] as const)),
  );
  try {
    await mkdir(paths.directory, {
      recursive: true,
      mode: state.mode === 'compose' ? 0o755 : 0o750,
    });
    if (process.platform !== 'win32') await chown(paths.directory, owner.uid, owner.gid);
    for (const [file, secret] of plan.secrets)
      await write(join(paths.directory, file), secret + '\n', owner, mode);
    for (const file of plan.drop) await unlink(join(paths.directory, file)).catch(() => undefined);
    if (last) await unlink(paths.webhooks).catch(() => undefined);
    else
      await write(
        paths.webhooks,
        JSON.stringify({ webhooks: plan.next }, null, 2) + '\n',
        owner,
        mode,
      );
    if (bundleAfter !== null) await write(paths.ca, bundleAfter, owner, mode);
    else await unlink(paths.ca).catch(() => undefined);
    if (state.mode === 'compose') {
      if (last) await unlink(paths.override).catch(() => undefined);
      else await atomicText(paths.override, override(), 0o600);
    }
    await replaceText(paths.runtime, JSON.stringify(env, null, 2) + '\n');
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    return change.detach ? 'detached' : 'attached';
  } catch (error) {
    await restore(snapshot, paths.runtime);
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    throw new Error(
      `The webhook was not ${change.detach ? 'detached' : 'configured'}; the previous configuration is restored (${error instanceof Error ? error.message : 'restart failed'})`,
      { cause: error },
    );
  }
}

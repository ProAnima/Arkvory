import { chown, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { atomicText, replaceText } from './files.js';
import type { Installation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import type { ServiceControl } from './tls-setup.js';
import { mergeCertificates, sourceCertificates, trustSourceCertificates } from './mirror-ca.js';

/** `arkvory configure --mirror …` (ADR 0058): one repository per call. */
export interface MirrorChange {
  readonly repository?: string;
  readonly upstream?: string;
  readonly sourceRepository?: string;
  readonly tokenFile?: string;
  /** Import mode: an ordinary repository taking over versions with these stages. */
  readonly stages?: readonly string[];
  /**
   * PEM with the authorities of mirror sources (corporate or self-signed); replaces the stored
   * bundle, which serves every mirror of the installation.
   */
  readonly caFile?: string;
  /** Turns a mirrored repository into an ordinary, writable one. */
  readonly detach?: string;
}
interface MirrorEntry {
  repository: string;
  upstream: string;
  sourceRepository: string;
  tokenFile: string;
  stages?: readonly string[];
}
/** Checks that the source answers this key with a change feed of the source repository. */
export type UpstreamProbe = (upstream: string, source: string, token: string) => Promise<void>;

export const mirrorsOverrideFile = 'config/compose.mirrors.yml';
const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const containerDirectory = '/run/arkvory/mirrors';

/** The stage rule of the product (domain requireStage), repeated: deploy has no domain access. */
function stageList(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const valid = value.every((stage) => /^[a-z0-9][a-z0-9_.-]{0,31}$/.test(stage));
  if (!valid || value.length === 0 || value.length > 16 || new Set(value).size !== value.length)
    throw new Error('--mirror-stages lists 1 to 16 distinct stage names');
  return value;
}

function repository(value: string | undefined, option: string): string {
  if (!value || !repositoryPattern.test(value)) throw new Error(`Invalid --${option}`);
  return value;
}

/** Same rule as the worker: an HTTPS origin, plain HTTP only to this host. */
export function upstreamOrigin(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('--mirror-upstream must be an https:// origin');
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('--mirror-upstream must be an https:// origin without path or credentials');
  return url.origin;
}

async function token(file: string | undefined): Promise<string> {
  if (!file || !isAbsolute(file)) throw new Error('--mirror-token-file must be an absolute path');
  const info = await stat(file);
  if (!info.isFile() || info.size > 4096) throw new Error('The mirror key file is not a key');
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[\x21-\x7e]{16,4000}$/.test(value)) throw new Error('The mirror key file is not a key');
  return value;
}

/** The public API of the source with the read-only key; the key never appears in a message. */
export const fetchProbe: UpstreamProbe = async (upstream, source, secret) => {
  const call = async (path: string) => {
    let response: Response;
    try {
      response = await fetch(upstream + path, {
        headers: { authorization: `Bearer ${secret}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`The source ${upstream} cannot be reached over verified TLS`, {
        cause: error,
      });
    }
    if (!response.ok)
      throw new Error(
        `The source refused ${path.split('?')[0] ?? path} (${String(response.status)})`,
      );
    return response.json();
  };
  const capabilities = await call('/api/v1/capabilities');
  const features =
    typeof capabilities === 'object' && capabilities !== null && 'features' in capabilities
      ? capabilities.features
      : null;
  if (typeof features !== 'object' || features === null || !('mirrorFeed' in features))
    throw new Error('The source is a release without the mirror change feed; update it first');
  await call(`/api/v1/repositories/${source}/changes?limit=1`);
};

interface Layout {
  readonly directory: string;
  readonly mirrors: string;
  /** Authorities of the sources, trusted by the worker besides its defaults. */
  readonly ca: string;
  readonly runtime: string;
  /** Paths as the API and worker read them (Compose: inside the containers). */
  readonly seen: (name: string) => string;
}
function layout(root: string, state: Installation): Layout {
  const directory = join(root, 'config/mirrors');
  return {
    directory,
    mirrors: join(directory, 'mirrors.json'),
    ca: join(directory, 'ca.pem'),
    runtime: join(root, 'config/runtime.json'),
    seen: (name) =>
      state.mode === 'compose' ? `${containerDirectory}/${name}` : join(directory, name),
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

function entries(text: string | null): MirrorEntry[] {
  if (text === null) return [];
  const document: unknown = JSON.parse(text);
  const list =
    typeof document === 'object' && document !== null && 'mirrors' in document
      ? document.mirrors
      : null;
  if (!Array.isArray(list)) throw new Error('config/mirrors/mirrors.json is not a mirrors file');
  const items: readonly unknown[] = list;
  return items.map((item) => {
    const row: Record<string, unknown> =
      typeof item === 'object' && item !== null ? Object.fromEntries(Object.entries(item)) : {};
    const { repository: name, upstream, sourceRepository, tokenFile } = row;
    if (
      typeof name !== 'string' ||
      typeof upstream !== 'string' ||
      typeof sourceRepository !== 'string' ||
      typeof tokenFile !== 'string'
    )
      throw new Error('config/mirrors/mirrors.json has an invalid entry');
    const raw: unknown = row['stages'];
    const listed: readonly unknown[] = Array.isArray(raw) ? raw : [];
    const stages = listed.filter((stage): stage is string => typeof stage === 'string');
    return {
      repository: name,
      upstream,
      sourceRepository,
      tokenFile,
      ...(stages.length > 0 ? { stages } : {}),
    };
  });
}

/**
 * Writes like runtime.json is owned: root:arkvory 0640 for systemd, readable by the container
 * user for Compose (the host config directory stays private), inherited ACLs on Windows.
 */
async function write(
  path: string,
  value: string,
  owner: { uid: number; gid: number },
  mode: number,
) {
  await atomicText(path, value, mode);
  if (process.platform !== 'win32') await chown(path, owner.uid, owner.gid);
}

function override(): string {
  const mount = `      - ./config/mirrors:${containerDirectory}:ro`;
  return [
    '# Generated by arkvory configure --mirror. Removed when the last mirror is detached.',
    'services:',
    '  api:',
    '    volumes:',
    mount,
    '  worker:',
    '    volumes:',
    mount,
    '',
  ].join('\n');
}

interface Snapshot {
  readonly runtime: string;
  readonly mirrors: string | null;
  readonly token: string | null;
  readonly ca: string | null;
  readonly override: string | null;
}

async function restore(paths: Layout, tokenPath: string, overridePath: string, before: Snapshot) {
  await replaceText(paths.runtime, before.runtime);
  for (const [path, text] of [
    [paths.mirrors, before.mirrors],
    [tokenPath, before.token],
    [paths.ca, before.ca],
    [overridePath, before.override],
  ] as const)
    if (text === null) await unlink(path).catch(() => undefined);
    else await atomicText(path, text, 0o600).catch(() => undefined);
}

/**
 * Attaches a mirrored repository (or replaces its key) or detaches one, then restarts API and
 * worker and requires readiness. The source is checked with the key before anything changes.
 * Any failure restores runtime.json, the mirrors file, the key and the Compose override and
 * restarts with them. Detaching keeps every artifact: the repository just becomes writable.
 */
export async function configureMirror(
  root: string,
  state: Installation,
  change: MirrorChange,
  services: ServiceControl,
  probe: UpstreamProbe = fetchProbe,
): Promise<'attached' | 'detached'> {
  const paths = layout(root, state);
  const before: Snapshot = {
    runtime: await readFile(paths.runtime, 'utf8'),
    mirrors: await optional(paths.mirrors),
    token: null,
    ca: await optional(paths.ca),
    override: await optional(join(root, mirrorsOverrideFile)),
  };
  const current = entries(before.mirrors);
  const target = repository(
    change.detach ?? change.repository,
    change.detach ? 'mirror-detach' : 'mirror',
  );
  const tokenPath = join(paths.directory, `${target}.token`);
  const snapshot = { ...before, token: await optional(tokenPath) };
  let next: MirrorEntry[];
  let secret: string | null = null;
  let bundle = before.ca;
  if (change.detach) {
    if (!current.some((entry) => entry.repository === target))
      throw new Error(`${target} is not a mirrored repository`);
    next = current.filter((entry) => entry.repository !== target);
  } else {
    const upstream = upstreamOrigin(change.upstream);
    const sourceRepository = repository(change.sourceRepository ?? target, 'mirror-source');
    const existing = current.find((entry) => entry.repository === target);
    if (
      existing &&
      (existing.upstream !== upstream || existing.sourceRepository !== sourceRepository)
    )
      throw new Error(`${target} mirrors another source; detach it first`);
    const stages = stageList(change.stages);
    secret = await token(change.tokenFile);
    if (change.caFile) bundle = mergeCertificates(bundle, await sourceCertificates(change.caFile));
    // The probe runs in this process: it trusts what the worker will trust, nothing more.
    if (bundle !== null) trustSourceCertificates(bundle);
    await probe(upstream, sourceRepository, secret);
    const entry = {
      repository: target,
      upstream,
      sourceRepository,
      tokenFile: paths.seen(`${target}.token`),
      ...(stages ? { stages } : {}),
    };
    next = [...current.filter((item) => item.repository !== target), entry];
  }
  const owner = await stat(paths.runtime);
  const mode = state.mode === 'compose' ? 0o644 : 0o640;
  const env = runtimeEnvironment(JSON.parse(before.runtime));
  // The authorities go with the last mirror; until then a detach keeps them for the others.
  if (next.length === 0) bundle = null;
  if (next.length > 0) env['ARKVORY_MIRRORS_FILE'] = paths.seen('mirrors.json');
  else delete env['ARKVORY_MIRRORS_FILE'];
  if (bundle !== null) env['ARKVORY_MIRRORS_CA_FILE'] = paths.seen('ca.pem');
  else delete env['ARKVORY_MIRRORS_CA_FILE'];
  try {
    await mkdir(paths.directory, {
      recursive: true,
      mode: state.mode === 'compose' ? 0o755 : 0o750,
    });
    if (process.platform !== 'win32') await chown(paths.directory, owner.uid, owner.gid);
    if (secret !== null) await write(tokenPath, secret + '\n', owner, mode);
    else await unlink(tokenPath).catch(() => undefined);
    if (next.length > 0)
      await write(paths.mirrors, JSON.stringify({ mirrors: next }, null, 2) + '\n', owner, mode);
    else await unlink(paths.mirrors).catch(() => undefined);
    if (bundle !== null) await write(paths.ca, bundle, owner, mode);
    else await unlink(paths.ca).catch(() => undefined);
    if (state.mode === 'compose') {
      if (next.length > 0) await atomicText(join(root, mirrorsOverrideFile), override(), 0o600);
      else await unlink(join(root, mirrorsOverrideFile)).catch(() => undefined);
    }
    await replaceText(paths.runtime, JSON.stringify(env, null, 2) + '\n');
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    return change.detach ? 'detached' : 'attached';
  } catch (error) {
    await restore(paths, tokenPath, join(root, mirrorsOverrideFile), snapshot);
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    throw new Error(
      `The mirror was not ${change.detach ? 'detached' : 'configured'}; the previous configuration is restored (${error instanceof Error ? error.message : 'restart failed'})`,
      { cause: error },
    );
  }
}

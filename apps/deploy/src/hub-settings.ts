import { randomUUID } from 'node:crypto';
import { chown, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, atomicText, jsonFile } from './files.js';
import { record } from './model.js';
import { runtimeEnvironment } from './runtime.js';

/** The ProAnimaStudio hub of this installation (ADR 0060); `url: null` turns it off. */
export interface HubSettings {
  readonly url: string | null;
  readonly project: string;
  readonly channel: 'stable' | 'beta';
  /** Anonymous statistics: the install id with update checks, and `updated` events. */
  readonly statistics: boolean;
}
export const defaultHub: HubSettings = {
  url: 'https://hub.proanima.net',
  project: 'arkvory',
  channel: 'stable',
  statistics: true,
};
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** https only; plain http on loopback for a hub under test. No credentials, query or fragment. */
export function hubUrl(value: string): string {
  const url = new URL(value);
  const plain = url.protocol === 'http:' && loopback.has(url.hostname);
  if (
    (url.protocol !== 'https:' && !plain) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('The hub address must be an https origin');
  return url.href.replace(/\/+$/, '');
}

export function parseHubSettings(value: unknown): HubSettings {
  const data = record(value);
  const { url, project, channel, statistics } = data;
  if (data['format'] !== 1 || typeof statistics !== 'boolean')
    throw new Error('Invalid hub settings');
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project))
    throw new Error('Invalid hub project');
  if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel');
  if (url !== null && typeof url !== 'string') throw new Error('Invalid hub address');
  return { url: url === null ? null : hubUrl(url), project, channel, statistics };
}

const settingsPath = (root: string) => join(root, 'config', 'hub.json');

/** Defaults until the operator changes them; a damaged file is an error, never a silent default. */
export async function hubSettings(root: string): Promise<HubSettings> {
  try {
    return parseHubSettings(await jsonFile(settingsPath(root)));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return defaultHub;
    throw error;
  }
}

export function saveHubSettings(root: string, settings: HubSettings): Promise<void> {
  return atomicJson(settingsPath(root), { format: 1, ...settings });
}

/**
 * The installation's random id, made once. It identifies nothing but the installation; the hub
 * uses it to place the installation in a staged rollout and to count active installations.
 */
export async function installId(root: string): Promise<string> {
  const path = join(root, 'config', 'install-id');
  try {
    const id = (await readFile(path, 'utf8')).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return id;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const id = randomUUID();
  await atomicText(path, `${id}\n`, 0o644);
  return id;
}

/**
 * The API's copy of the hub address, for console feedback (ARKVORY_HUB_URL in runtime.json):
 * absent is the studio hub, empty is off. Owner and mode stay as they were; the services read
 * it on their next start.
 */
export async function writeRuntimeHub(root: string, url: string | null): Promise<void> {
  const path = join(root, 'config', 'runtime.json');
  const info = await stat(path);
  const env = runtimeEnvironment(await jsonFile(path));
  if (url === defaultHub.url) Reflect.deleteProperty(env, 'ARKVORY_HUB_URL');
  else env['ARKVORY_HUB_URL'] = url ?? '';
  await atomicText(path, `${JSON.stringify(env, null, 2)}\n`, info.mode & 0o777);
  if (process.platform !== 'win32') await chown(path, info.uid, info.gid);
}

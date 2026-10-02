import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { requireStage } from '@proanima/arkvory-domain';

/** One mirrored repository of this installation (ADR 0058). */
export interface MirrorSettings {
  /** Local repository that mirrors the source; read-only for every client. */
  readonly repository: string;
  /** Origin of the source installation, e.g. https://arkvory.example (no path or credentials). */
  readonly upstream: string;
  readonly sourceRepository: string;
  /**
   * File with a read-only key of the source; read by the worker only, never logged. A corporate
   * CA of the source is trusted through NODE_EXTRA_CA_CERTS of the worker; TLS is always verified.
   */
  readonly tokenFile: string;
  /**
   * Import mode (ADR 0058): an ordinary, writable repository that takes over the versions given
   * one of these stages on the source; deletions there do not reach it. Absent: a mirror.
   */
  readonly stages?: readonly string[];
}

const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const maxMirrors = 64;

function fail(field: string): never {
  throw new Error(`Invalid ARKVORY_MIRRORS_FILE: ${field}`);
}

function upstream(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) fail('upstream');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('upstream');
  }
  // The source key travels in every request: plain HTTP only to this host (tests, a local proxy).
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    fail('upstream');
  return url.origin;
}

function path(value: unknown, field = 'tokenFile'): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.length > 1024 ||
    value.includes('\0')
  )
    fail(field);
  return value;
}

function entry(value: unknown): MirrorSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('mirror');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const known = ['repository', 'upstream', 'sourceRepository', 'tokenFile', 'stages'];
  if (Object.keys(row).some((key) => !known.includes(key))) fail('unknown field');
  const { repository, sourceRepository } = row;
  if (typeof repository !== 'string' || !repositoryPattern.test(repository)) fail('repository');
  if (typeof sourceRepository !== 'string' || !repositoryPattern.test(sourceRepository))
    fail('sourceRepository');
  return {
    repository,
    upstream: upstream(row['upstream']),
    sourceRepository,
    tokenFile: path(row['tokenFile']),
    ...(row['stages'] === undefined ? {} : { stages: stages(row['stages']) }),
  };
}

function stages(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) fail('stages');
  const list: readonly unknown[] = value;
  const parsed = list.map((stage) => {
    try {
      return requireStage(stage);
    } catch {
      fail('stages');
    }
  });
  if (new Set(parsed).size !== parsed.length) fail('stages');
  return parsed;
}

/** `{ "mirrors": [...] }`; each local repository mirrors at most one source. */
export function parseMirrorSettings(value: unknown): readonly MirrorSettings[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('document');
  const document: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(document).some((key) => key !== 'mirrors')) fail('unknown field');
  const list = document['mirrors'];
  if (!Array.isArray(list) || list.length > maxMirrors) fail('mirrors');
  const entries: readonly unknown[] = list;
  const mirrors = entries.map(entry);
  if (new Set(mirrors.map((mirror) => mirror.repository)).size !== mirrors.length)
    fail('duplicate repository');
  return mirrors;
}

/** No file configured means no mirrors; a configured but unreadable file stops startup. */
export async function readMirrorSettings(
  file: string | undefined,
): Promise<readonly MirrorSettings[]> {
  if (file === undefined || file === '') return [];
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error('ARKVORY_MIRRORS_FILE cannot be read', { cause: error });
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid ARKVORY_MIRRORS_FILE: JSON', { cause: error });
  }
  return parseMirrorSettings(document);
}

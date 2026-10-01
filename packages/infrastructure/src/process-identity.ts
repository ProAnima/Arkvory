import { readFile } from 'node:fs/promises';
import { hostname as systemHostname } from 'node:os';
import type { LogService, ProcessIdentity } from './diagnostics.js';

const versionPattern = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

/** Hostnames are operator data, not secrets, but still bounded to a safe character set. */
function safeHostname(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return cleaned || 'unknown';
}

export function processIdentity(
  service: LogService,
  version: string,
  pid: number = process.pid,
  hostname: string = systemHostname(),
): ProcessIdentity {
  return {
    service,
    version: versionPattern.test(version) ? version : 'dev',
    pid: Number.isSafeInteger(pid) && pid > 0 ? pid : 0,
    hostname: safeHostname(hostname),
  };
}

/**
 * Release version from the staged release manifest (releases/<version>/release.json, written by
 * the installer). Development checkouts and malformed manifests report 'dev': logging must never
 * prevent startup.
 */
export async function readReleaseVersion(manifest: URL): Promise<string> {
  try {
    const text = await readFile(manifest, 'utf8');
    if (text.length > 64 * 1024) return 'dev';
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return 'dev';
    const version: unknown = Reflect.get(value, 'version');
    return typeof version === 'string' && versionPattern.test(version) ? version : 'dev';
  } catch {
    return 'dev';
  }
}

import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import type { LicenceEnvironment, LicenceSignal } from '@proanima/arkvory-application';
import type { SigningKey } from '@proanima/arkvory-signing';
import { httpLicenceHub, readLicenceHubSettings } from './licence-hub.js';
import type { LicenceHubSettings } from './licence-hub.js';
import { installedLicenceModules } from './licence-modules.js';
import { fileActivationSecrets } from './licence-secrets.js';
import { PostgresLicenceStore } from './licence-store.js';
import { licenceVerifier } from './licence-verifier.js';

/** Where licensing lives on a host (ADR 0078, R2); the deployment sets these paths. */
export interface LicenceConfiguration {
  /** `config/licenses`: the activation secrets. */
  readonly directory: string;
  readonly hub: LicenceHubSettings;
  /** `config/install-id`; null before the installation has one. */
  readonly installation: string | null;
  readonly modulesDirectory: string | undefined;
}

const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;

async function installationOf(path: string | undefined): Promise<string | null> {
  if (path === undefined || path === '') return null;
  try {
    const id = (await readFile(path, 'utf8')).trim();
    return INSTALL_ID.test(id) ? id : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The licensing paths of this process: `ARKVORY_LICENSE_DIR`, `ARKVORY_HUB_FILE`,
 * `ARKVORY_INSTALL_ID_FILE` and `ARKVORY_MODULES_DIR`. Null without a licence directory: the
 * process then has no licensing to do (Compose containers, development servers).
 */
export async function readLicenceConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): Promise<LicenceConfiguration | null> {
  const directory = env['ARKVORY_LICENSE_DIR'];
  if (directory === undefined || directory === '') return null;
  if (!isAbsolute(directory)) throw new Error('ARKVORY_LICENSE_DIR must be absolute');
  return {
    directory,
    hub: await readLicenceHubSettings(env['ARKVORY_HUB_FILE']),
    installation: await installationOf(env['ARKVORY_INSTALL_ID_FILE']),
    modulesDirectory: env['ARKVORY_MODULES_DIR'],
  };
}

/**
 * The pool of licence exchanges, apart from the process's own: an exchange holds the session
 * lock 18471/30 on one connection while it waits for the hub, and must not take the connections
 * of jobs or requests. Bounded statements; idle errors never reach logs with the URL.
 */
export function licencePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 15000,
    idle_in_transaction_session_timeout: 60000,
    keepAlive: true,
  });
  pool.on('error', () => undefined);
  return pool;
}

/** A request nonce of 128 random bits, base64url (22 characters). */
export const licenceNonce = () => randomBytes(16).toString('base64url');

async function sleep(ms: number, signal?: LicenceSignal) {
  await delay(ms, undefined, signal instanceof AbortSignal ? { signal } : {}).catch(
    () => undefined,
  );
}

/** The licence use cases' dependencies over this database, host and hub. */
export function licenceEnvironment(
  pool: Pool,
  configuration: LicenceConfiguration,
  coreVersion: string,
  options: { readonly roots?: readonly SigningKey[]; readonly fetch?: typeof fetch } = {},
): LicenceEnvironment {
  return {
    hub: httpLicenceHub(configuration.hub, options.fetch),
    secrets: fileActivationSecrets(configuration.directory),
    store: new PostgresLicenceStore(pool),
    verifier: licenceVerifier(options.roots),
    nonce: licenceNonce,
    random: () => randomInt(1_000_000) / 1_000_000,
    sleep,
    // The hub takes semver only: a development build without a release is `0.0.0-dev`.
    coreVersion: /^\d+\.\d+\.\d+/.test(coreVersion) ? coreVersion : '0.0.0-dev',
    modules: () => installedLicenceModules(configuration.modulesDirectory),
  };
}

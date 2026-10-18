import './confine.js';
import { readFile, lstat, open, unlink } from 'node:fs/promises';
import {
  activateLicence,
  createOfflineRequest,
  deactivateLicence,
  installLicenceDocument,
  licenceIso,
  licenceOverview,
  refreshLicence,
} from '@proanima/arkvory-application';
import type {
  LicenceEnvironment,
  LicenceExchangeResult,
  LicenceInstallResult,
} from '@proanima/arkvory-application';
import {
  licenceEnvironment,
  licenceKeyDigest,
  licencePool,
  licenseViewOf,
  normaliseLicenceKey,
  readLicenceConfiguration,
  readReleaseVersion,
} from '@proanima/arkvory-infrastructure';
import type { LicenceConfiguration } from '@proanima/arkvory-infrastructure';

/**
 * `arkvory license …` on the host of the writer (ADR 0078, R2), run by the deployment tool
 * through the launcher with the installation's runtime environment. The licence key is read from
 * a file, sent only in the body of an activation request and never printed, stored or logged;
 * activation secrets go to `ARKVORY_LICENSE_DIR` only. Messages name machine codes, never a key,
 * a secret or a document.
 */
const USAGE =
  'arkvory license activate --key-file <file> | refresh [<activation>] | deactivate <licence|activation> | status [--json] | request --key-file <file> --out <file> | install <file>';
const KEY_FILE_LIMIT = 4096;
const DOCUMENT_LIMIT = 1024 * 1024;

class LicenceCommandError extends Error {
  override readonly name = 'LicenceCommandError';
}

function parse(args: readonly string[]) {
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg === '--json') flags.add('json');
    else if (arg === '--key-file' || arg === '--out') {
      const value = args[++index];
      if (value === undefined || value.startsWith('--') || options.has(arg))
        throw new LicenceCommandError(`Missing or repeated ${arg}`);
      options.set(arg, value);
    } else if (arg.startsWith('--')) throw new LicenceCommandError(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  return { options, flags, positional };
}

async function boundedFile(path: string, limit: number): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new LicenceCommandError('Not a readable file');
  return readFile(path, 'utf8');
}

/** The key of a key file, normalised; its text never appears in a message. */
async function keyOf(path: string | undefined): Promise<string> {
  if (path === undefined) throw new LicenceCommandError('Pass the licence key in --key-file');
  const key = normaliseLicenceKey((await boundedFile(path, KEY_FILE_LIMIT)).trim());
  if (key === null)
    throw new LicenceCommandError('The key file holds no valid licence key; check it for typos');
  return key;
}

function installationOf(configuration: LicenceConfiguration): string {
  if (configuration.installation === null)
    throw new LicenceCommandError('The installation has no id yet (config/install-id)');
  return configuration.installation;
}

const time = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '-' : licenceIso(ms);

function said(result: LicenceExchangeResult | LicenceInstallResult): boolean {
  switch (result.outcome) {
    case 'activated':
    case 'refreshed':
      console.log(
        `${result.outcome === 'activated' ? 'Activated' : 'Refreshed'} licence ${result.licenceId} (activation ${result.activationId}, seq ${String(result.seq)}); valid offline until ${time(result.notAfter)}`,
      );
      return true;
    case 'installed':
      console.log(
        `Installed licence ${result.licenceId} (activation ${result.activationId}); valid until ${time(result.notAfter)}`,
      );
      return true;
    case 'list':
      console.log(
        `Licence revocation list ${String(result.number)} ${result.changed ? 'installed' : 'already installed'}`,
      );
      return true;
    case 'revoked':
      console.log(`Licence ${result.licenceId} is revoked: ${result.reason}`);
      return true;
    case 'released':
      console.log(`Activation ${result.activationId} released; its secret is deleted`);
      return true;
    case 'busy':
      console.error('Another licence exchange is running; try again in a few minutes');
      return false;
    case 'refused':
    case 'failed': {
      const next =
        'nextAttemptAt' in result && result.nextAttemptAt
          ? `; next try ${time(result.nextAttemptAt)}`
          : '';
      console.error(`Licence ${result.outcome}: ${result.code}${next}`);
      return false;
    }
  }
}

async function status(env: LicenceEnvironment, json: boolean): Promise<boolean> {
  const overview = await licenceOverview(env);
  const licences = overview.licences.map((licence) => ({
    activationId: licence.activationId,
    licensee: licence.licensee,
    ...licenseViewOf(overview, licence),
  }));
  if (json) {
    const { installation, clockRollback, pendingRequests } = overview;
    const effectiveTime = licenceIso(overview.effectiveTime);
    console.log(
      JSON.stringify(
        { installation, effectiveTime, clockRollback, pendingRequests, licenses: licences },
        null,
        2,
      ),
    );
    return true;
  }
  console.log(
    `Installation ${overview.installation ?? '(not recorded yet)'}; effective time ${time(overview.effectiveTime)}`,
  );
  if (overview.clockRollback) console.log('Warning: clock_rollback_detected');
  if (overview.pendingRequests > 0)
    console.log(`Offline requests waiting: ${String(overview.pendingRequests)}`);
  if (licences.length === 0)
    console.log('No licence: every function of the free core works without one');
  for (const l of licences)
    console.log(
      [
        `${l.licenseId ?? '-'} ${l.licenseType ?? '-'} "${l.licensee ?? '-'}" (${l.activation ?? '-'} activation ${l.activationId})`,
        `  state ${l.state}${l.reason ? ` (${l.reason})` : ''}; features ${l.features.join(', ') || '-'}`,
        `  term until ${l.notAfter ?? 'perpetual'}; grace until ${l.graceUntil ?? '-'}; token until ${l.offlineGraceUntil ?? '-'}`,
        `  last refresh ${l.lastRefreshAt ?? '-'}${l.refreshFailing ? ' (refresh failing)' : ''}`,
      ].join('\n'),
    );
  return true;
}

/**
 * Opens the request file first (`wx`: an earlier request is never overwritten), so a refused
 * file leaves no pending request behind; a failed request leaves no empty file.
 */
async function writeRequest(path: string | undefined, make: () => Promise<string>) {
  if (path === undefined) throw new LicenceCommandError('Pass the request file in --out');
  const file = await open(path, 'wx', 0o644);
  try {
    await file.writeFile(await make(), 'utf8');
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await file.close();
}

async function targets(env: LicenceEnvironment, id: string | undefined, online: boolean) {
  const rows = await env.store.activations();
  const chosen = rows.filter((row) =>
    id === undefined
      ? !online || (row.activation === 'online' && row.revocation === null)
      : row.activationId === id || row.licenceId === id,
  );
  if (id !== undefined && chosen.length === 0)
    throw new LicenceCommandError('No such licence or activation on this installation');
  return chosen.map((row) => row.activationId);
}

async function run(command: string, args: readonly string[]): Promise<boolean> {
  const { options, flags, positional } = parse(args);
  const configuration = await readLicenceConfiguration(process.env);
  if (configuration === null) throw new LicenceCommandError('ARKVORY_LICENSE_DIR is not set');
  const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
  if (!databaseUrl) throw new LicenceCommandError('ARKVORY_DATABASE_URL is required');
  // releases/<version>/apps/worker/dist/license.js -> releases/<version>/release.json
  const version = await readReleaseVersion(new URL('../../../release.json', import.meta.url));
  const pool = licencePool(databaseUrl);
  try {
    const env = licenceEnvironment(pool, configuration, version);
    switch (command) {
      case 'activate': {
        const key = await keyOf(options.get('--key-file'));
        const installation = installationOf(configuration);
        if (configuration.hub.url === null)
          throw new LicenceCommandError('The hub is off: use license request and license install');
        const result = await activateLicence(env, { key, installation });
        if (result.outcome === 'activated') await env.store.observe(installation);
        return said(result);
      }
      case 'refresh': {
        let ok = true;
        for (const id of await targets(env, positional[0], true))
          ok = said(await refreshLicence(env, id)) && ok;
        return ok;
      }
      case 'deactivate': {
        if (positional[0] === undefined)
          throw new LicenceCommandError('Name the licence or activation');
        let ok = true;
        for (const id of await targets(env, positional[0], false))
          ok = said(await deactivateLicence(env, id)) && ok;
        return ok;
      }
      case 'status':
        return await status(env, flags.has('json'));
      case 'request': {
        const key = await keyOf(options.get('--key-file'));
        const installation = installationOf(configuration);
        await writeRequest(options.get('--out'), async () => {
          const request = await createOfflineRequest(env, {
            keySha256: licenceKeyDigest(key),
            installation,
          });
          return `${JSON.stringify(request, null, 2)}\n`;
        });
        console.log(
          'Request written; it holds no secret. Upload it in your ProAnimaStudio account',
        );
        return true;
      }
      case 'install': {
        const path = positional[0];
        if (path === undefined) throw new LicenceCommandError('Name the file to install');
        const text = (await boundedFile(path, DOCUMENT_LIMIT)).trim();
        return said(await installLicenceDocument(env, text, installationOf(configuration)));
      }
      default:
        throw new LicenceCommandError(`Usage: ${USAGE}`);
    }
  } finally {
    await pool.end();
  }
}

const [command = '', ...rest] = process.argv.slice(2);
run(command, rest).then(
  (ok) => {
    process.exitCode = ok ? 0 : 1;
  },
  (error: unknown) => {
    // Own messages and system codes only: an error from below may carry a path or a server text.
    const code =
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]{2,40}$/.test(error.code)
        ? error.code
        : error instanceof Error
          ? error.name
          : 'error';
    console.error(
      error instanceof LicenceCommandError ? error.message : `Licence command failed (${code})`,
    );
    process.exitCode = 1;
  },
);

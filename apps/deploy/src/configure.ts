import { join } from 'node:path';
import { configureBackup } from './backup-setup.js';
import { jsonFile } from './files.js';
import { parseInstallation, version } from './model.js';
import type { Installation } from './model.js';
import { checkJournal, save } from './operations.js';
import { report } from './output.js';
import { Services } from './services.js';
import { configureTls } from './tls-setup.js';

const httpsOptions = ['tls-cert', 'tls-key', 'tls-off', 'listen-host'];
const vaultOptions = ['backup-vault', 'init-vault', 'backup-vault-off'];
const updateOptions = ['disable-updates', 'enable-updates', 'pin', 'unpin', 'version'];

async function configureHttps(root: string, state: Installation, options: Map<string, string>) {
  const certificateFile = options.get('tls-cert');
  const keyFile = options.get('tls-key');
  const host = options.get('listen-host');
  const expires = await configureTls(
    root,
    state,
    {
      ...(certificateFile ? { certificateFile } : {}),
      ...(keyFile ? { keyFile } : {}),
      ...(host ? { host } : {}),
      disable: options.has('tls-off'),
    },
    new Services(root, state),
  );
  report(
    'info',
    expires
      ? `Built-in HTTPS is active; the certificate expires ${expires.toISOString()}`
      : 'Built-in HTTPS is off; the API serves plain HTTP',
  );
}

async function configureVault(root: string, state: Installation, options: Map<string, string>) {
  const vault = options.get('backup-vault');
  const outcome = await configureBackup(
    root,
    state,
    {
      ...(vault ? { vault } : {}),
      initialize: options.has('init-vault'),
      disable: options.has('backup-vault-off'),
    },
    new Services(root, state),
  );
  report(
    'info',
    outcome.vaultId
      ? `Backup vault ${outcome.vaultId} is ${outcome.initialized ? 'initialized and ' : ''}in use; the agent reports it available`
      : 'The backup vault is off; the agent runs and reports vault_not_configured',
  );
}

async function configureUpdates(root: string, state: Installation, options: Map<string, string>) {
  if (options.has('disable-updates')) state.automatic = false;
  if (options.has('enable-updates')) state.automatic = true;
  if (options.has('pin')) state.pin = version(options.get('version') ?? state.current.version);
  if (options.has('unpin')) state.pin = null;
  await save(root, state);
  if (state.automatic) await new Services(root, state).schedule(state.current);
}

/**
 * `arkvory configure` runs under the installation lock taken by main. One kind of change per
 * call: HTTPS and the backup vault restart services and roll back on their own, update policy
 * only rewrites installation.json.
 */
export async function configure(root: string, options: Map<string, string>): Promise<void> {
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const used = (names: readonly string[]) => names.some((name) => options.has(name));
  const kinds = [used(httpsOptions), used(vaultOptions), used(updateOptions)].filter(Boolean);
  if (kinds.length > 1)
    throw new Error('Change HTTPS, the backup vault and update policy in separate configure calls');
  if (used(httpsOptions) || used(vaultOptions)) {
    // Restarting services must not race an interrupted release switch.
    await checkJournal(root);
    await (used(httpsOptions) ? configureHttps : configureVault)(root, state, options);
  } else await configureUpdates(root, state, options);
}

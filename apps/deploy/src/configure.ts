import { join } from 'node:path';
import { configureBackup } from './backup-setup.js';
import { jsonFile } from './files.js';
import { parseInstallation, version } from './model.js';
import type { Installation } from './model.js';
import { checkJournal, save } from './operations.js';
import { report } from './output.js';
import { Services } from './services.js';
import { configureTls } from './tls-setup.js';
import { configureMirror } from './mirror-setup.js';
import { hubSettings, hubUrl, saveHubSettings, writeRuntimeHub } from './hub-settings.js';

const httpsOptions = ['tls-cert', 'tls-key', 'tls-off', 'listen-host'];
const vaultOptions = ['backup-vault', 'init-vault', 'backup-vault-off'];
const updateOptions = [
  'disable-updates',
  'enable-updates',
  'pin',
  'unpin',
  'version',
  'hub-url',
  'hub-off',
  'update-channel',
  'statistics',
];
const mirrorOptions = [
  'mirror',
  'mirror-upstream',
  'mirror-source',
  'mirror-token-file',
  'mirror-stages',
  'mirror-detach',
];

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

async function configureMirrors(root: string, state: Installation, options: Map<string, string>) {
  const value = (name: string) => options.get(name);
  const repository = value('mirror');
  const upstream = value('mirror-upstream');
  const sourceRepository = value('mirror-source');
  const tokenFile = value('mirror-token-file');
  const detach = value('mirror-detach');
  const stages = value('mirror-stages')
    ?.split(',')
    .map((stage) => stage.trim());
  const outcome = await configureMirror(
    root,
    state,
    {
      ...(repository ? { repository } : {}),
      ...(upstream ? { upstream } : {}),
      ...(sourceRepository ? { sourceRepository } : {}),
      ...(tokenFile ? { tokenFile } : {}),
      ...(stages ? { stages } : {}),
      ...(detach ? { detach } : {}),
    },
    new Services(root, state),
  );
  report(
    'info',
    outcome === 'attached'
      ? stages
        ? `${repository ?? ''} imports versions with stage ${stages.join(', ')}; it stays writable here`
        : `${repository ?? ''} is a mirror; the worker synchronizes it and clients can only read it`
      : `${detach ?? ''} is an ordinary repository again; its artifacts stay and accept writes`,
  );
}

/** The hub of ADR 0060: address or off, update channel, anonymous statistics. */
async function configureHub(root: string, options: Map<string, string>) {
  const url = options.get('hub-url'),
    channel = options.get('update-channel'),
    statistics = options.get('statistics');
  if (
    url === undefined &&
    channel === undefined &&
    statistics === undefined &&
    !options.has('hub-off')
  )
    return;
  if (url !== undefined && options.has('hub-off')) throw new Error('Use --hub-url or --hub-off');
  if (channel !== undefined && channel !== 'stable' && channel !== 'beta')
    throw new Error('--update-channel is stable or beta');
  if (statistics !== undefined && statistics !== 'on' && statistics !== 'off')
    throw new Error('--statistics is on or off');
  const current = await hubSettings(root);
  const next = {
    ...current,
    url: options.has('hub-off') ? null : url === undefined ? current.url : hubUrl(url),
    channel: channel ?? current.channel,
    statistics: statistics === undefined ? current.statistics : statistics === 'on',
  };
  await saveHubSettings(root, next);
  if (next.url !== current.url) await writeRuntimeHub(root, next.url);
  report(
    'info',
    `Updates from ${next.url ?? 'GitHub only'} (${next.channel}); anonymous statistics ${next.statistics ? 'on' : 'off'}${next.url !== current.url ? '; console feedback follows after the next service restart' : ''}`,
  );
}

async function configureUpdates(root: string, state: Installation, options: Map<string, string>) {
  await configureHub(root, options);
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
  const groups = [httpsOptions, vaultOptions, mirrorOptions, updateOptions];
  if (groups.filter(used).length > 1)
    throw new Error(
      'Change HTTPS, the backup vault, mirrors and update policy in separate configure calls',
    );
  const restarting = [
    [httpsOptions, configureHttps],
    [vaultOptions, configureVault],
    [mirrorOptions, configureMirrors],
  ] as const;
  const change = restarting.find(([names]) => used(names));
  if (change) {
    // Restarting services must not race an interrupted release switch.
    await checkJournal(root);
    await change[1](root, state, options);
  } else await configureUpdates(root, state, options);
}

import { resolve, join } from 'node:path';
import { exclusive, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import { install, update, recover, upgrade, finishInstall, checkJournal } from './operations.js';
import { Services } from './services.js';
import { deploymentHelp } from './help.js';
import { createOwner } from './owner.js';
import { pollUpdates, resetUpdateRequest } from './update-control.js';
import { prepareUpdateControl } from './update-setup.js';
import { report } from './output.js';
import { runWithLogFile } from './log-file.js';
import { configure } from './configure.js';
import { warnEngineAutostart } from './engine-autostart.js';

function argumentsOf(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  const flags = [
    'automatic',
    'scheduled',
    'pin',
    'disable-updates',
    'enable-updates',
    'unpin',
    'log-captured',
    'tls-off',
    'hub-off',
    'init-vault',
    'backup-vault-off',
  ];
  const values = [
    'root',
    'mode',
    'engine',
    'version',
    'artifact',
    'config',
    'backup-record',
    'database-bin',
    'owner-file',
    'tls-cert',
    'tls-key',
    'listen-host',
    'hub-url',
    'update-channel',
    'statistics',
    'backup-vault',
    'mirror',
    'mirror-upstream',
    'mirror-source',
    'mirror-token-file',
    'mirror-stages',
    'mirror-ca-file',
    'mirror-detach',
  ];
  for (let index = 0; index < args.length; index++) {
    const name = args[index]?.replace(/^--/, '');
    if (!name || !args[index]?.startsWith('--') || options.has(name))
      throw new Error('Invalid or duplicate argument');
    if (flags.includes(name)) options.set(name, 'true');
    else if (values.includes(name)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing --${name} value`);
      options.set(name, value);
    } else throw new Error(`Unknown option --${name}`);
  }
  return options;
}
/**
 * Task Scheduler discards a task's output. Without a console, the Windows updater re-runs itself
 * with stdout and stderr appended to logs/updater.log. Task arguments stay unchanged, so an older
 * release (after a rollback) keeps working with the same registration.
 */
async function capturedUpdater(
  operation: string,
  options: Map<string, string>,
  root: string,
): Promise<boolean> {
  if (
    operation !== 'updates-poll' ||
    process.platform !== 'win32' ||
    process.stdout.isTTY ||
    options.has('log-captured')
  )
    return false;
  const code = await runWithLogFile(join(root, 'logs', 'updater.log'), process.execPath, [
    process.argv[1] ?? '',
    ...process.argv.slice(2),
    '--log-captured',
  ]);
  if (code === undefined) {
    report('warning', 'Updater log is unavailable; continuing without a log file');
    return false;
  }
  process.exitCode = code;
  return true;
}
async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error('Arkvory requires Node.js 24 LTS');
  const operation = process.argv[2] ?? '';
  if (['', '--help', '-h', 'help'].includes(operation)) {
    console.log(deploymentHelp());
    return;
  }
  const options = argumentsOf(process.argv.slice(3));
  const rawRoot = options.get('root');
  if (!rawRoot) throw new Error('Specify --root (absolute installation directory)');
  const root = resolve(rawRoot);
  if (/[\r\n\0"%$`]/.test(root)) throw new Error('Unsupported installation path');
  if (operation === 'status') {
    const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
    console.log(state);
    await warnEngineAutostart(state);
    return;
  }
  if (await capturedUpdater(operation, options, root)) return;
  await exclusive(root, async () => {
    switch (operation) {
      case 'updates-poll':
        await pollUpdates(root);
        break;
      case 'updates-reset':
        await resetUpdateRequest(root);
        break;
      case 'updates-connect': {
        await checkJournal(root);
        await prepareUpdateControl(root);
        const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
        const services = new Services(root, state);
        await services.stop();
        await services.provision(state.current);
        await services.start(state.current);
        await services.healthy();
        await services.confirmBackup(state.current);
        await services.schedule(state.current);
        break;
      }
      case 'install':
        await install(root, options);
        if (options.get('owner-file')) await createOwner(root, options.get('owner-file') ?? '');
        break;
      case 'finish-install':
        await finishInstall(root);
        if (options.get('owner-file')) await createOwner(root, options.get('owner-file') ?? '');
        break;
      case 'apply-installer': {
        const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
        if (state.mode !== (process.platform === 'win32' ? 'windows' : 'systemd'))
          throw new Error('Native installer cannot change deployment mode');
        const artifact = options.get('artifact');
        if (!artifact) throw new Error('Installer requires local release artifact');
        const candidate = await jsonFile(join(artifact, 'arkvory-release.json'));
        const { parseRelease } = await import('./model.js');
        const next = parseRelease(candidate);
        if (next.version === state.current.version) {
          if (
            next.archiveSha256 !== state.current.archiveSha256 ||
            next.setupSha256 !== state.current.setupSha256
          )
            throw new Error('Installed version cannot be replaced with different bytes');
          await finishInstall(root);
        } else await update(root, options);
        break;
      }
      case 'update':
        await update(root, options);
        break;
      case 'recover':
        await recover(root);
        break;
      case 'upgrade':
        await upgrade(root, options);
        break;
      case 'configure':
        await configure(root, options);
        break;
      default:
        throw new Error('Commands: install, status, update, configure, recover, upgrade');
    }
  });
}
main().catch((error: unknown) => {
  // Configuration and child-process errors can contain credentials; report() redacts every line.
  report('error', error instanceof Error ? error.message : 'Deployment failed');
  process.exitCode = 1;
});

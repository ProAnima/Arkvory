import './confine.js';
import { resolve, join } from 'node:path';
import { jsonFile } from './files.js';
import { exclusive } from './operation-lock.js';
import { parseInstallation } from './model.js';
import { install, update, recover, upgrade, finishInstall, checkJournal } from './operations.js';
import { Services } from './services.js';
import { deploymentHelp } from './help.js';
import { createOwner } from './owner.js';
import { pollChanges, resetChanges } from './site-changes.js';
import { isUnconfirmedTermination } from './process.js';
import { pollUpdates, resetUpdateRequest } from './update-control.js';
import { prepareUpdateControl } from './update-setup.js';
import { report } from './output.js';
import { runWithLogFile } from './log-file.js';
import { configure } from './configure.js';
import { warnEngineAutostart } from './engine-autostart.js';
import { clusterStatus, decideSingleCopy, serveReplica } from './replica-service.js';
import { joinNode, nodeMarker, refreshNodeKit, syncUnits } from './cluster-node.js';
import { releaseVolume } from './cluster-volume.js';
import { writeKitFile } from './cluster-kit.js';
import { writePlan } from './cluster-plan-files.js';
import { checkCluster, fenceTest, switchover } from './cluster-ops.js';
import { moduleCommand } from './module-commands.js';
import { expectMount, initializeVolume } from './storage-volume.js';

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
    'vault-no-encryption',
    'backup-vault-off',
    'off',
    'yes',
    'expect-mount',
    'no-expect-mount',
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
    'vault-key-file',
    'mirror',
    'mirror-upstream',
    'mirror-source',
    'mirror-token-file',
    'mirror-stages',
    'mirror-ca-file',
    'mirror-detach',
    'webhook',
    'webhook-repository',
    'webhook-url',
    'webhook-secret-file',
    'webhook-next-secret-file',
    'webhook-actions',
    'webhook-allow-private',
    'webhook-ca-file',
    'webhook-detach',
    'until',
    'reason',
    'cluster',
    'cluster-resource',
    'nodes',
    'witness',
    'disk',
    'fence-agent',
    'virtual-ip',
    'drbd-minor',
    'drbd-port',
    'filesystem',
    'output',
    'to',
    'node',
    'kit',
    'directory',
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
async function connectUpdates(root: string): Promise<void> {
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
}

/** The native installer's step: finish the same release, or update to a new one. */
async function applyInstaller(root: string, options: Map<string, string>): Promise<void> {
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
}

/** The operations that change an installation; each runs under its operation lock. */
async function locked(operation: string, root: string, options: Map<string, string>) {
  switch (operation) {
    case 'updates-poll': {
      // Site changes (ADR 0077) share the tick and the lock; one failing does not stop the other.
      const failures: unknown[] = [];
      await pollUpdates(root).catch((error: unknown) => failures.push(error));
      // An update command that may still run leaves the installation in an unknown state:
      // no change is applied over it (pollChanges checks the journal for a settled one).
      if (!failures.some((failure) => isUnconfirmedTermination(failure)))
        await pollChanges(root).catch((error: unknown) => failures.push(error));
      // A command that may still run keeps the lock: its failure is the one that counts.
      const kept = failures.find((failure) => isUnconfirmedTermination(failure));
      if (failures.length) throw kept ?? failures[0];
      break;
    }
    case 'changes-reset':
      await resetChanges(root);
      break;
    case 'updates-reset':
      await resetUpdateRequest(root);
      break;
    case 'updates-connect':
      await connectUpdates(root);
      break;
    case 'install':
      await install(root, options);
      if (options.get('owner-file')) await createOwner(root, options.get('owner-file') ?? '');
      break;
    case 'finish-install':
      await finishInstall(root);
      if (options.get('owner-file')) await createOwner(root, options.get('owner-file') ?? '');
      break;
    case 'apply-installer':
      await applyInstaller(root, options);
      break;
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
      throw new Error(`Unknown command ${operation}`);
  }
}

/** Every command `main` accepts; anything else is refused before it touches an installation. */
const COMMANDS = new Set([
  'install',
  'finish-install',
  'apply-installer',
  'status',
  'update',
  'recover',
  'upgrade',
  'configure',
  'updates-poll',
  'updates-reset',
  'changes-reset',
  'updates-connect',
  'cluster-plan',
  'cluster-check',
  'cluster-switchover',
  'cluster-fence-test',
  'cluster-status',
  'cluster-single-copy',
  'cluster-replica',
  'cluster-units',
  'cluster-node',
  'cluster-release',
  'cluster-kit',
  'volume-init',
]);

/**
 * Cluster commands on one node that run outside the installation lock (ADR 0072): long-running
 * services, reads and an operator's decision during an incident. The steps that take or release
 * the volume hold the lock only while it is mounted here: the lock lives on the volume.
 */
async function nodeOperation(
  operation: string,
  root: string,
  options: Map<string, string>,
): Promise<boolean> {
  const resource = options.get('cluster-resource');
  const guard = (work: () => Promise<void>) => exclusive(root, work, 120_000, operation);
  switch (operation) {
    case 'cluster-replica':
      await serveReplica(root);
      return true;
    case 'cluster-status':
      await clusterStatus(root);
      return true;
    case 'cluster-units':
      await syncUnits(root);
      return true;
    case 'cluster-single-copy':
      await decideSingleCopy(root, options);
      return true;
    case 'cluster-node':
      await joinNode(root, resource, options.get('kit'), guard);
      return true;
    case 'cluster-release':
      await releaseVolume(root, (await nodeMarker())?.resource ?? resource ?? 'arkvory', { guard });
      return true;
    case 'cluster-kit': {
      const output = options.get('output');
      if (!output) throw new Error('cluster-kit needs --output <file>');
      await writeKitFile(root, output);
      return true;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error('Arkvory requires Node.js 24 LTS');
  const operation = process.argv[2] ?? '';
  if (['', '--help', '-h', 'help'].includes(operation)) {
    console.log(deploymentHelp());
    return;
  }
  // `arkvory module <command> …` has subcommands and arguments of its own (ADR 0078, 0082).
  if (operation === 'module') return moduleCommand(process.argv.slice(3));
  if (!COMMANDS.has(operation))
    throw new Error(`Unknown command ${operation}; "arkvory help" lists every command`);
  const options = argumentsOf(process.argv.slice(3));
  // Planning needs no installation: it may run on a workstation.
  if (operation === 'cluster-plan') return writePlan(options);
  // Pacemaker operations act on the cluster, not on an installation's files.
  if (operation === 'cluster-check') return checkCluster();
  if (operation === 'cluster-switchover') return switchover(options.get('to'));
  if (operation === 'cluster-fence-test') return fenceTest(options.get('node'), options.has('yes'));
  // A storage volume is marked on the host before any service may use it (ADR 0083, N11).
  if (operation === 'volume-init') {
    const directory = options.get('directory');
    if (!directory) throw new Error('volume-init needs --directory <absolute directory>');
    await initializeVolume({ directory, expectMount: expectMount(options) });
    report('info', 'Storage volume initialized; add it to the modules file and restart');
    return;
  }
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
  if (await nodeOperation(operation, root, options)) return;
  if (await capturedUpdater(operation, options, root)) return;
  // The timer's own tick tries again in a minute; an operator's command waits for it instead.
  const waitMs = operation === 'updates-poll' ? 0 : 120_000;
  await exclusive(
    root,
    async () => {
      await locked(operation, root, options);
      await refreshNodeKit(root);
    },
    waitMs,
    operation,
  );
}
main().catch((error: unknown) => {
  // Configuration and child-process errors can contain credentials; report() redacts every line.
  report('error', error instanceof Error ? error.message : 'Deployment failed');
  process.exitCode = 1;
});

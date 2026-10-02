import { join } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import type { BackupStatusResponse } from '@proanima/arkvory-contracts';
import { provisionDatabase, databaseSettings } from './managed-database.js';
import { command, isUnconfirmedTermination } from './process.js';
import type { Installation, Release } from './model.js';
import { atomicCopy, exists, jsonFile } from './files.js';
import {
  backupRegistered,
  backupRunning,
  shipsBackupRole,
  startBackup,
  stopWindowsBackup,
} from './backup-service.js';
import type { BackupSupervision } from './backup-service.js';
import { backupStatus, reportBackupAgent } from './backup-probe.js';
import type { BackupServiceControl } from './backup-setup.js';
import { VaultAccess, vaultOverrideFile } from './vault-access.js';
import { runtimeEnvironment } from './runtime.js';
import { setTimeout as delay } from 'node:timers/promises';
import { healthReady } from './health.js';
import { localTarget } from './local-api.js';
import type { LocalTarget } from './local-api.js';
import { windowsAdministrator } from './preflight.js';
import { report } from './output.js';

export class Services implements BackupServiceControl {
  private readonly backup: BackupSupervision;
  constructor(
    private readonly root: string,
    private readonly state: Installation,
  ) {
    this.backup = { root, state, compose: (release, args) => this.compose(release, args) };
  }
  private async compose(release: Release, args: string[]): Promise<void> {
    const files = ['-f', join(this.root, 'releases', release.version, 'deploy/compose.yml')];
    // The vault bind mount exists only for a release that declares the backup service.
    const override = join(this.root, vaultOverrideFile);
    if ((await exists(override)) && (await shipsBackupRole(this.root, this.state, release)))
      files.push('-f', override);
    await command(
      this.state.engine,
      [
        'compose',
        '--project-name',
        'proanima-arkvory',
        '--project-directory',
        this.root,
        '--env-file',
        join(this.root, 'config/compose.env'),
        ...files,
        ...args,
      ],
      undefined,
      { ARKVORY_IMAGE: `proanima-arkvory:${release.version}` },
    );
  }
  async prepare(release: Release): Promise<void> {
    if (this.state.mode !== 'compose' && (await databaseSettings(this.root))) {
      await provisionDatabase(this.root, join(this.root, 'releases', release.version));
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt++) {
        try {
          await access(join(this.root, 'database/initialized'));
          ready = true;
          break;
        } catch {
          await delay(1000);
        }
      }
      if (!ready)
        throw new Error('Database setup failed; inspect database service logs before retrying');
    }
    if (this.state.mode === 'compose') {
      await command(this.state.engine, [
        'build',
        '--tag',
        `proanima-arkvory:${release.version}`,
        '--file',
        join(this.root, 'releases', release.version, 'deploy/Dockerfile'),
        join(this.root, 'releases', release.version),
      ]);
    }
  }
  async migrate(release: Release): Promise<void> {
    if (this.state.mode === 'compose') {
      await this.compose(release, ['up', '-d', '--wait', 'database']);
      await this.compose(release, ['run', '--rm', 'initialize']);
      await this.compose(release, ['run', '--rm', 'migrate']);
    } else await command(process.execPath, [join(this.root, 'launcher.mjs'), this.root, 'migrate']);
  }
  /** Stops the agent first: its running phase ends as `interrupted` and the job is queued again. */
  async stop(): Promise<void> {
    const backup = await backupRunning(this.backup);
    if (this.state.mode === 'compose')
      await this.compose(this.state.current, [
        'stop',
        '--timeout',
        '120',
        ...(backup ? ['backup'] : []),
        'worker',
        'api',
      ]);
    else if (this.state.mode === 'systemd')
      await command('systemctl', [
        'stop',
        ...(backup ? ['arkvory-backup'] : []),
        'arkvory-worker',
        'arkvory-api',
      ]);
    else {
      if (backup) await stopWindowsBackup(this.root);
      for (const role of ['worker', 'api'])
        // WinSW stop returns before shutdown; wait before switching the release pointer.
        await command(join(this.root, `service/arkvory-${role}.exe`), ['stopwait']);
    }
  }
  /** API and worker decide readiness; the agent starts afterwards and may fail on its own. */
  async start(release: Release): Promise<void> {
    if (this.state.mode === 'compose') {
      await this.compose(release, ['up', '-d', '--wait', '--wait-timeout', '180', 'api', 'worker']);
    } else if (this.state.mode === 'systemd')
      await command('systemctl', ['start', 'arkvory-api', 'arkvory-worker']);
    else
      for (const role of ['api', 'worker'])
        await command(join(this.root, `service/arkvory-${role}.exe`), ['start']);
    await startBackup(this.backup, release);
  }
  /**
   * Registers the roles of `release` that an installation created by an older release lacks
   * (today: the backup agent). A one-time full provision, the same as a repair.
   */
  async adopt(release: Release): Promise<void> {
    if (
      this.state.mode === 'compose' ||
      (await backupRegistered(this.root, this.state)) ||
      !(await shipsBackupRole(this.root, this.state, release))
    )
      return;
    report('info', 'Registering the backup agent service of this release');
    await this.provision(release);
  }
  /** After readiness: an absent agent is a warning, never a failed install or update. */
  async confirmBackup(release: Release): Promise<void> {
    if (!(await shipsBackupRole(this.root, this.state, release))) return;
    if (this.state.mode !== 'compose' && !(await backupRegistered(this.root, this.state))) return;
    await reportBackupAgent(() => this.backupStatus());
  }
  backupStatus(): Promise<BackupStatusResponse> {
    return backupStatus(this.root, this.state);
  }
  async restartBackup(): Promise<void> {
    if (await backupRunning(this.backup)) {
      if (this.state.mode === 'compose')
        await this.compose(this.state.current, ['stop', '--timeout', '120', 'backup']);
      else if (this.state.mode === 'systemd')
        await command('systemctl', ['stop', 'arkvory-backup']);
      else await stopWindowsBackup(this.root);
    }
    await startBackup(this.backup, this.state.current, true);
  }
  openVault(vault: string | null): Promise<() => Promise<void>> {
    return new VaultAccess(this.root, this.state, this.backup.compose).open(vault);
  }
  initializeVault(vault: string): Promise<void> {
    return new VaultAccess(this.root, this.state, this.backup.compose).initialize(vault);
  }
  /** One readiness probe; a seam so the retry loop can be exercised without a live API. */
  ready(target: LocalTarget, tokenFile: string): Promise<boolean> {
    return healthReady(target, tokenFile);
  }
  async healthy(): Promise<void> {
    const env = runtimeEnvironment(await jsonFile(join(this.root, 'config/runtime.json')));
    // Compose publishes the container port on host loopback regardless of ARKVORY_HOST.
    const target = localTarget(env, this.state.mode === 'compose');
    let consecutive = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        consecutive = (await this.ready(target, join(this.root, 'config/health-token.txt')))
          ? consecutive + 1
          : 0;
        if (consecutive >= 3) {
          await this.workerRunning();
          return;
        }
      } catch (error) {
        // A readiness retry must not hide a live command from update recovery and its lock.
        if (isUnconfirmedTermination(error)) throw error;
        consecutive = 0;
      }
      await delay(2000);
    }
    throw new Error('Arkvory did not become ready');
  }
  /**
   * Service units run root/launcher.mjs, a bundle copied at installation. A release that adds a
   * role brings a launcher that knows it; launchers stay compatible with older releases' roles.
   */
  private async refreshLauncher(release: Release): Promise<void> {
    const directory = join(this.root, 'releases', release.version);
    const source = join(directory, 'deploy/launcher.mjs');
    const target = join(this.root, 'launcher.mjs');
    if ((await readFile(source)).equals(await readFile(target))) return;
    await atomicCopy(source, target, 0o644);
    // A new file inherits only the root ACL; the managed database grants NetworkService again.
    if (this.state.mode === 'windows') await provisionDatabase(this.root, directory);
  }
  async provision(release: Release): Promise<void> {
    if (this.state.mode === 'compose') return;
    await this.refreshLauncher(release);
    const script = join(
      this.root,
      'releases',
      release.version,
      'deploy',
      this.state.mode === 'windows' ? 'register-windows.ps1' : 'register-linux.sh',
    );
    if (this.state.mode === 'windows')
      await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Root',
        this.root,
        '-Node',
        process.execPath,
      ]);
    else await command('bash', [script, this.root, process.execPath]);
  }
  private async workerRunning(): Promise<void> {
    if (this.state.mode === 'systemd')
      await command('systemctl', ['is-active', '--quiet', 'arkvory-worker']);
    else if (this.state.mode === 'windows')
      await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "if ((Get-Service Arkvoryworker).Status -ne 'Running') { exit 1 }",
      ]);
    else
      await this.compose(this.state.current, [
        'exec',
        '-T',
        'worker',
        'node',
        '-e',
        'process.exit(0)',
      ]);
  }
  async schedule(release: Release): Promise<void> {
    const windows = process.platform === 'win32';
    const manual =
      'Register the host updater as administrator, or schedule updates-poll under the container engine owner.';
    if (!windows) {
      try {
        await access('/run/systemd/system');
      } catch {
        report(
          'warning',
          'Host updater needs an external scheduler: run updates-poll every minute.',
        );
        return;
      }
      if (process.getuid?.() !== 0) {
        report('warning', manual);
        return;
      }
    } else if (this.state.mode === 'compose' && !(await windowsAdministrator())) {
      // Same contract as a docker-group user on Linux: no SYSTEM task without elevation.
      report('warning', manual);
      return;
    }
    const script = join(
      this.root,
      'releases',
      release.version,
      'deploy',
      windows ? 'schedule-windows.ps1' : 'schedule-linux.sh',
    );
    if (windows)
      await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Root',
        this.root,
        '-Node',
        process.execPath,
      ]);
    else await command('bash', [script, this.root, process.execPath]);
  }
}

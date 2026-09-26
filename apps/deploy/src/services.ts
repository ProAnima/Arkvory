import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { provisionDatabase, databaseSettings } from './managed-database.js';
import { command, isUnconfirmedTermination } from './process.js';
import type { Installation, Release } from './model.js';
import { jsonFile } from './files.js';
import { runtimeEnvironment } from './runtime.js';
import { setTimeout as delay } from 'node:timers/promises';
import { healthReady } from './health.js';

export class Services {
  constructor(
    private readonly root: string,
    private readonly state: Installation,
  ) {}
  private compose(release: Release, args: string[]): Promise<void> {
    return command(
      this.state.engine,
      [
        'compose',
        '--project-name',
        'proanima-depot',
        '--project-directory',
        this.root,
        '--env-file',
        join(this.root, 'config/compose.env'),
        '-f',
        join(this.root, 'releases', release.version, 'deploy/compose.yml'),
        ...args,
      ],
      undefined,
      { DEPOT_IMAGE: `proanima-depot:${release.version}` },
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
        `proanima-depot:${release.version}`,
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
  async prepareUpdateInbox(release: Release): Promise<void> {
    if (this.state.mode === 'compose') await this.compose(release, ['run', '--rm', 'initialize']);
  }
  async stop(): Promise<void> {
    if (this.state.mode === 'compose')
      await this.compose(this.state.current, ['stop', '--timeout', '120', 'worker', 'api']);
    else if (this.state.mode === 'systemd')
      await command('systemctl', ['stop', 'depot-worker', 'depot-api']);
    else
      for (const role of ['worker', 'api'])
        // WinSW stop returns before shutdown; wait before switching the release pointer.
        await command(join(this.root, `service/depot-${role}.exe`), ['stopwait']);
  }
  async start(release: Release): Promise<void> {
    if (this.state.mode === 'compose') {
      await this.compose(release, ['up', '-d', '--wait', '--wait-timeout', '180', 'api', 'worker']);
    } else if (this.state.mode === 'systemd')
      await command('systemctl', ['start', 'depot-api', 'depot-worker']);
    else
      for (const role of ['api', 'worker'])
        await command(join(this.root, `service/depot-${role}.exe`), ['start']);
  }
  async healthy(): Promise<void> {
    const env = runtimeEnvironment(await jsonFile(join(this.root, 'config/runtime.json')));
    const port = this.state.mode === 'compose' ? '8080' : (env['DEPOT_PORT'] ?? '8080');
    if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid health port');
    let consecutive = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        consecutive = (await healthReady(port, join(this.root, 'config/health-token.txt')))
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
    throw new Error('Depot did not become ready');
  }
  async provision(release: Release): Promise<void> {
    if (this.state.mode === 'compose') return;
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
      await command('systemctl', ['is-active', '--quiet', 'depot-worker']);
    else if (this.state.mode === 'windows')
      await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "if ((Get-Service Depotworker).Status -ne 'Running') { exit 1 }",
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
    if (!windows) {
      try {
        await access('/run/systemd/system');
      } catch {
        console.log('Host updater needs an external scheduler: run updates-poll every minute.');
        return;
      }
      if (process.getuid?.() !== 0) {
        console.log(
          'Register the host updater as administrator, or schedule updates-poll under the container engine owner.',
        );
        return;
      }
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

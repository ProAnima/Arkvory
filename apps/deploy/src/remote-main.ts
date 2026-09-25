import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createRemoteWizard } from './remote-server.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Depot Remote Setup · Ian Panaev / ProAnimaStudio\nLaunch without arguments to open the secure remote installation wizard.\n--artifact <directory> uses a reviewed local native release instead of GitHub.',
    );
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--artifact' && args[1]))
    throw new Error('Invalid arguments');
  const wizard = await createRemoteWizard(args[1] ? { artifact: resolve(args[1]) } : {});
  const launch =
    process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', wizard.url]
      : ['xdg-open', wizard.url];
  const executable = launch.shift();
  if (!executable) throw new Error('Browser launcher unavailable');
  const child = spawn(executable, launch, { stdio: 'ignore', windowsHide: true });
  child.once('error', () => {
    wizard.close();
    console.error('Cannot open browser');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    if (code !== 0) {
      wizard.close();
      process.exitCode = 1;
    }
  });
  for (const event of ['SIGINT', 'SIGTERM'] as const) process.once(event, wizard.close);
}
main().catch(() => {
  console.error('Cannot start Depot Remote Setup');
  process.exitCode = 1;
});

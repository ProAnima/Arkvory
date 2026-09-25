import { resolve, join } from 'node:path';
import { exclusive, jsonFile } from './files.js';
import { parseInstallation, version } from './model.js';
import { install, update, recover, upgrade, save, finishInstall } from './operations.js';
import { Services } from './services.js';

function argumentsOf(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  const flags = ['automatic', 'scheduled', 'pin', 'disable-updates', 'enable-updates', 'unpin'];
  const values = ['root', 'mode', 'engine', 'version', 'artifact', 'config', 'backup-record'];
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
async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error('Depot requires Node.js 24 LTS');
  const operation = process.argv[2] ?? '';
  const options = argumentsOf(process.argv.slice(3));
  const rawRoot = options.get('root');
  if (!rawRoot) throw new Error('Specify --root (absolute installation directory)');
  const root = resolve(rawRoot);
  if (/[\r\n\0"%$`]/.test(root)) throw new Error('Unsupported installation path');
  if (operation === 'status') {
    console.log(parseInstallation(await jsonFile(join(root, 'installation.json'))));
    return;
  }
  await exclusive(root, async () => {
    switch (operation) {
      case 'install':
        await install(root, options);
        break;
      case 'finish-install':
        await finishInstall(root);
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
      case 'configure': {
        const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
        if (options.has('disable-updates')) state.automatic = false;
        if (options.has('enable-updates')) state.automatic = true;
        if (options.has('pin'))
          state.pin = version(options.get('version') ?? state.current.version);
        if (options.has('unpin')) state.pin = null;
        await save(root, state);
        if (state.automatic) await new Services(root, state).schedule(state.current);
        break;
      }
      default:
        throw new Error('Commands: install, status, update, configure, recover, upgrade');
    }
  });
}
main().catch((error: unknown) => {
  // Configuration and child-process errors can contain credentials; only our controlled errors reach stderr.
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL redacted]')
      : 'Deployment failed',
  );
  process.exitCode = 1;
});

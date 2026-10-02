import { isAbsolute } from 'node:path';
import { runRole } from './runtime.js';
import { vaultContents } from './vault-location.js';

const [role = 'api', ...args] = process.argv.slice(2);
// `configure --backup-vault` reads the vault as its owner, the container user (vault-access.ts).
if (role === 'vault-inspect') {
  const [vault] = args;
  if (args.length !== 1 || !vault || !isAbsolute(vault))
    throw new Error('vault-inspect expects one absolute vault directory');
  process.stdout.write(JSON.stringify(await vaultContents(vault)) + '\n');
} else await runRole('/opt/arkvory', '/run/arkvory/runtime.json', role, args);

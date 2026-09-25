import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsonFile } from './files.js';
import { parseInstallation } from './model.js';
const root = process.argv[process.argv.indexOf('--root') + 1];
if (!root || !process.argv.includes('--root')) throw new Error('Specify --root');
const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
await import(
  pathToFileURL(join(root, 'releases', state.current.version, 'apps/deploy/dist/main.js')).href
);

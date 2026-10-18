import './confine.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowResolutionUnder } from '@proanima/arkvory-resolution';
import { jsonFile } from './files.js';
import { parseInstallation } from './model.js';
const root = process.argv[process.argv.indexOf('--root') + 1];
if (!root || !process.argv.includes('--root')) throw new Error('Specify --root');
const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
const release = join(root, 'releases', state.current.version);
// This bundle resolves only built-ins; the deployment code of the current release is the one
// directory it may load from (ADR 0031, addendum 2026-10-18).
allowResolutionUnder(release);
await import(pathToFileURL(join(release, 'apps/deploy/dist/main.js')).href);

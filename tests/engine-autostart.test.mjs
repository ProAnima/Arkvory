import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerDesktopAutostart } from '../apps/deploy/dist/engine-autostart.js';
import { removeTestDirectory } from './helpers.mjs';

test('Docker Desktop autostart is read from its settings, and unknown elsewhere', async (t) => {
  const appData = await mkdtemp(join(tmpdir(), 'arkvory-appdata-'));
  t.after(() => removeTestDirectory(appData));
  await mkdir(join(appData, 'Docker'));
  const settings = (value) =>
    writeFile(join(appData, 'Docker', 'settings-store.json'), JSON.stringify(value));
  await settings({ AutoStart: false, CustomWslDistroDir: 'E:\wsl' });
  assert.equal(await dockerDesktopAutostart(appData, 'win32'), false);
  await settings({ AutoStart: true });
  assert.equal(await dockerDesktopAutostart(appData, 'win32'), true);
  // Older Docker Desktop releases kept settings.json with a lower-case key.
  await writeFile(join(appData, 'Docker', 'settings-store.json'), 'not json');
  await writeFile(join(appData, 'Docker', 'settings.json'), JSON.stringify({ autoStart: false }));
  assert.equal(await dockerDesktopAutostart(appData, 'win32'), false);
  assert.equal(await dockerDesktopAutostart(appData, 'linux'), null);
  assert.equal(await dockerDesktopAutostart(join(appData, 'missing'), 'win32'), null);
  assert.equal(await dockerDesktopAutostart('', 'win32'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeRuntimeSettings } from '../packages/contracts/dist/index.js';
import { compatiblePath } from '../apps/cli/dist/legacy-files.js';
import { assertArkvoryInstallation } from '../apps/deploy/dist/brand-transition.js';
import { removeTestDirectory } from './helpers.mjs';

test('legacy settings preserve values, refuse ambiguity and never expose credential values', () => {
  const source = {
    DEPOT_DATABASE_URL: 'postgres://secret@host/depot',
    DEPOT_DATA_DIR: '/srv/depot',
    PATH: '/bin',
  };
  assert.deepEqual(normalizeRuntimeSettings(source), {
    ARKVORY_DATABASE_URL: source.DEPOT_DATABASE_URL,
    ARKVORY_DATA_DIR: source.DEPOT_DATA_DIR,
    PATH: '/bin',
  });
  assert.ok(source.DEPOT_DATA_DIR);
  assert.throws(
    () => normalizeRuntimeSettings({ DEPOT_TOKEN: 'secret-old', ARKVORY_TOKEN: 'secret-new' }),
    (error) => error.message === 'Conflicting configuration: ARKVORY_TOKEN',
  );
  assert.deepEqual(normalizeRuntimeSettings({ DEPOT_PORT: '8080', ARKVORY_PORT: '8080' }), {
    ARKVORY_PORT: '8080',
  });
});

test('existing CLI checkpoints are reused without copying bytes and duplicate identities fail closed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-brand-'));
  t.after(() => removeTestDirectory(root));
  const old = join(root, 'file.depot-upload.json'),
    current = join(root, 'file.arkvory-upload.json');
  assert.equal(compatiblePath(current, old), current);
  await writeFile(old, 'checkpoint');
  assert.equal(compatiblePath(current, old), old);
  await writeFile(current, 'other checkpoint');
  assert.throws(() => compatiblePath(current, old));
});

test('managed deployment refuses a legacy root before service identities can change', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-brand-'));
  t.after(() => removeTestDirectory(root));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'config'));
  await writeFile(
    join(root, 'config/runtime.json'),
    JSON.stringify({ DEPOT_DATA_DIR: '/old/data' }),
  );
  await assert.rejects(assertArkvoryInstallation(root), /Legacy Depot installation/);
  assert.equal(
    JSON.parse(await readFile(join(root, 'config/runtime.json'), 'utf8')).DEPOT_DATA_DIR,
    '/old/data',
  );
});

test('launcher icons include bounded PNG frames for every supported Windows size', async () => {
  for (const name of ['arkvory', 'arkvory-cli', 'arkvory-remote']) {
    const icon = await readFile(`branding/icons/${name}.ico`);
    assert.equal(icon.readUInt16LE(0), 0);
    assert.equal(icon.readUInt16LE(2), 1);
    assert.equal(icon.readUInt16LE(4), 7);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    for (let i = 0; i < sizes.length; i++) {
      const entry = 6 + i * 16,
        size = icon[entry] || 256;
      assert.equal(size, sizes[i]);
      const length = icon.readUInt32LE(entry + 8),
        offset = icon.readUInt32LE(entry + 12);
      assert.ok(offset >= 118 && offset + length <= icon.length);
      assert.equal(icon.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(icon.readUInt32BE(offset + 16), size);
      assert.equal(icon.readUInt32BE(offset + 20), size);
    }
  }
  const html = await readFile('apps/web/index.html', 'utf8');
  assert.match(html, /class="brand-mark"[\s\S]*?src="\/console\/arkvory.svg"/);
  assert.doesNotMatch(html, /Depot|depot/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareUpdateControl } from '../apps/deploy/dist/update-setup.js';
import { removeTestDirectory } from './helpers.mjs';

test('update bridge preparation overrides private installer umask without opening the host root', async (t) => {
  for (const mode of ['systemd', 'compose']) {
    const root = await mkdtemp(join(tmpdir(), 'arkvory-update-setup-'));
    t.after(() => removeTestDirectory(root));
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config/runtime.json'), '{}');
    await writeFile(
      join(root, 'installation.json'),
      JSON.stringify({
        format: 1,
        mode,
        engine: 'docker',
        automatic: false,
        pin: null,
        current: {
          format: 1,
          version: '1.0.0',
          schema: 17,
          commit: 'a'.repeat(40),
          archiveSha256: 'b'.repeat(64),
          setupSha256: 'c'.repeat(64),
        },
      }),
    );
    const mask = process.umask(0o077);
    try {
      await prepareUpdateControl(root);
    } finally {
      process.umask(mask);
    }
    const snapshot = JSON.parse(await readFile(join(root, 'updates/status/snapshot.json'), 'utf8'));
    assert.equal(snapshot.currentVersion, '1.0.0');
    assert.equal(snapshot.automatic, false);
    const runtime = JSON.parse(await readFile(join(root, 'config/runtime.json'), 'utf8'));
    assert.equal(
      runtime.ARKVORY_UPDATE_CONTROL_DIR,
      mode === 'compose' ? '/run/arkvory-updates' : join(root, 'updates'),
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(root)).mode & 0o777, 0o700);
      assert.equal((await stat(join(root, 'updates/status'))).mode & 0o777, 0o755);
      assert.equal((await stat(join(root, 'updates/status/snapshot.json'))).mode & 0o777, 0o644);
      assert.equal(
        (await stat(join(root, 'updates/inbox'))).mode & 0o777,
        mode === 'compose' ? 0o777 : 0o755,
      );
    }
  }
});

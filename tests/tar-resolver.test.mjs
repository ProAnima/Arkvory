import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarExecutable } from '../scripts/tar.mjs';
import { removeTestDirectory } from './helpers.mjs';

test('Windows uses System32 bsdtar regardless of PATH order; other hosts use tar', () => {
  const gitFirst = 'C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\System32';
  assert.equal(
    tarExecutable('win32', { SystemRoot: 'C:\\Windows', Path: gitFirst }),
    'C:\\Windows\\System32\\tar.exe',
  );
  assert.equal(tarExecutable('win32', { SYSTEMROOT: 'D:/Win' }), 'D:\\Win\\System32\\tar.exe');
  for (const platform of ['linux', 'darwin', 'freebsd'])
    assert.equal(tarExecutable(platform, { SystemRoot: 'C:\\Windows' }), 'tar');
});

test('Windows without a local absolute SystemRoot fails instead of trusting PATH', () => {
  for (const environment of [
    {},
    { SystemRoot: '' },
    { SystemRoot: 'Windows' },
    { SystemRoot: '\\Windows' },
    { SystemRoot: '\\\\server\\share\\Windows' },
  ])
    assert.throws(() => tarExecutable('win32', environment), /SystemRoot/);
});

test('resolved host tar round-trips gzip archives with absolute paths containing spaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-tar resolver '));
  try {
    const tar = tarExecutable();
    if (process.platform === 'win32')
      assert.match(execFileSync(tar, ['--version'], { encoding: 'utf8' }), /bsdtar/);
    const source = join(root, 'source dir');
    const target = join(root, 'target dir');
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, 'install.sh'), 'echo ok\n');
    const archive = join(root, 'bundle archive.tar.gz');
    execFileSync(tar, ['-czf', archive, '-C', source, 'install.sh'], { windowsHide: true });
    execFileSync(tar, ['-xzf', archive, '-C', target], { windowsHide: true });
    assert.equal(await readFile(join(target, 'install.sh'), 'utf8'), 'echo ok\n');
  } finally {
    await removeTestDirectory(root);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  licenseCommand,
  parseLicenseCommand,
  prepareLicenceDirectory,
} from '../apps/deploy/dist/license-commands.js';
import { licenseEnvironment, roleCommand } from '../apps/deploy/dist/runtime.js';
import { removeTestDirectory } from './helpers.mjs';

const ROOT = resolve(tmpdir(), 'arkvory-root');
const LIC = 'lic_0123456789ABCDEFGHJKMNPQRS';
const ACT = 'act_0123456789ABCDEFGHJKMNPQRS';

test('license commands are parsed strictly; files become absolute; the key is never an argument', () => {
  const work = resolve(tmpdir(), 'work');
  assert.deepEqual(
    parseLicenseCommand(['activate', '--key-file', 'key.txt', '--root', ROOT], work),
    {
      command: 'activate',
      root: ROOT,
      args: ['activate', '--key-file', resolve(work, 'key.txt')],
    },
  );
  assert.deepEqual(parseLicenseCommand(['status', '--json', '--root', ROOT]).args, [
    'status',
    '--json',
  ]);
  assert.deepEqual(parseLicenseCommand(['refresh', '--root', ROOT]).args, ['refresh']);
  assert.deepEqual(parseLicenseCommand(['refresh', ACT, '--root', ROOT]).args, ['refresh', ACT]);
  assert.deepEqual(parseLicenseCommand(['deactivate', LIC, '--root', ROOT]).args, [
    'deactivate',
    LIC,
  ]);
  assert.deepEqual(
    parseLicenseCommand(['request', '--key-file', 'k', '--out', 'r.json', '--root', ROOT], work)
      .args,
    ['request', '--key-file', resolve(work, 'k'), '--out', resolve(work, 'r.json')],
  );
  assert.deepEqual(parseLicenseCommand(['install', 'answer.json', '--root', ROOT], work).args, [
    'install',
    resolve(work, 'answer.json'),
  ]);
  const refused = [
    [['activate', '--root', ROOT], /needs --key-file/],
    [['activate', '--key', 'ARKV-K1-XXXX', '--root', ROOT], /Unknown option --key /],
    [['activate', '--key-file', 'a', '--key-file', 'b', '--root', ROOT], /Repeated/],
    [['status'], /--root/],
    [['deactivate', '--root', ROOT], /Wrong number/],
    [['deactivate', 'licence-1', '--root', ROOT], /lic_/],
    [['refresh', ACT, ACT, '--root', ROOT], /Wrong number/],
    [['request', '--key-file', 'k', '--root', ROOT], /needs --out/],
    [['remove', LIC, '--root', ROOT], /Usage/],
    [['status', '--root', '/tmp/a"b'], /Unsupported/],
  ];
  for (const [args, message] of refused)
    assert.throws(() => parseLicenseCommand(args), message, JSON.stringify(args));
});

test('the launcher runs license commands of the release; services get the licence paths', () => {
  assert.deepEqual(roleCommand('license', ['status', '--json']), {
    entry: 'apps/worker/dist/license.js',
    argv: ['status', '--json'],
    service: false,
  });
  assert.throws(() => roleCommand('license', []), /license expects/);
  assert.throws(() => roleCommand('license', ['remove']), /license expects/);
  assert.throws(() => roleCommand('license', ['install', 'a\nb']), /license expects/);
  assert.throws(() => roleCommand('worker', ['status']), /no arguments/);
  assert.deepEqual(licenseEnvironment(ROOT), {
    ARKVORY_LICENSE_DIR: join(ROOT, 'config', 'licenses'),
    ARKVORY_HUB_FILE: join(ROOT, 'config', 'hub.json'),
    ARKVORY_INSTALL_ID_FILE: join(ROOT, 'config', 'install-id'),
  });
});

test('a Compose installation has no licence to activate; the directory belongs to the service', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-license-'));
  t.after(() => removeTestDirectory(root));
  const current = { format: 1, version: '0.6.0', commit: 'a'.repeat(40), schema: 45 };
  await writeFile(
    join(root, 'installation.json'),
    JSON.stringify({
      format: 1,
      mode: 'compose',
      engine: 'docker',
      automatic: false,
      pin: null,
      current: { ...current, archiveSha256: 'b'.repeat(64), setupSha256: 'c'.repeat(64) },
    }),
  );
  await assert.rejects(licenseCommand(['status', '--root', root]), /Compose installations/);
  await assert.rejects(stat(join(root, 'config')), { code: 'ENOENT' }, 'nothing was created');
  if (process.platform === 'win32') return;
  await mkdir(join(root, 'data'));
  await mkdir(join(root, 'config'));
  const directory = await prepareLicenceDirectory(root);
  const info = await stat(directory);
  assert.equal(info.mode & 0o777, 0o700);
  assert.equal(info.uid, (await stat(join(root, 'data'))).uid);
});

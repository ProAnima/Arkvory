import { execFileSync } from 'node:child_process';
import { readFile, writeFile, access, mkdtemp, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyNativeFiles } from '../../scripts/native-files.mjs';
import { exerciseRpm } from './native-rpm.mjs';

// This gate uses production service names only on disposable CI machines, never a developer workstation.
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Native installation acceptance requires a disposable Actions runner',
);
const windows = process.platform === 'win32';
const output = resolve(process.env.DEPOT_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
const manifest = JSON.parse(
  await readFile(join(output, `native-${process.platform}.json`), 'utf8'),
);
await verifyNativeFiles(
  output,
  manifest.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  [process.platform],
);
const root = windows ? join(process.env.ProgramData, 'ProAnima/Depot') : '/opt/proanima-depot';
await assert.rejects(
  access(join(root, 'installation.json')),
  /ENOENT/,
  'Never overwrite an installed Depot',
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
);
const run = (file, args) =>
  execFileSync(file, args, { env, stdio: 'inherit', windowsHide: true, timeout: 300000 });
const read = async (path) => {
  if (!windows) return execFileSync('sudo', ['cat', path], { encoding: 'utf8' });
  const bytes = await readFile(path);
  // Windows PowerShell 5 redirects to UTF-16; decode before redacting diagnostics.
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString('utf16le')
    : bytes.toString('utf8');
};
const temporary = await mkdtemp(join(tmpdir(), 'depot-owner-gate-'));
const password = randomBytes(24).toString('hex');
const ownerFile = join(temporary, 'owner.json');
await writeFile(ownerFile, JSON.stringify({ name: 'native-owner', password }), { mode: 0o600 });
const started = Date.now();
try {
  if (windows) {
    run('icacls.exe', [ownerFile, '/inheritance:r', '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F']);
    run(join(output, 'Depot-Setup-x64.exe'), [
      '/VERYSILENT',
      '/SUPPRESSMSGBOXES',
      '/NORESTART',
      `/OWNERFILE=${ownerFile}`,
      `/LOG=${join(temporary, 'setup.log')}`,
    ]);
  } else run('sudo', ['apt-get', 'install', '-y', join(output, 'Depot-amd64.deb')]);
  const token = await read(join(root, 'config/bootstrap-token.txt'));
  const response = await fetch('http://127.0.0.1:8080/health/ready', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  assert.equal((await fetch('http://127.0.0.1:8080/console/')).status, 200);
  console.log(`Initial native readiness in ${Math.round((Date.now() - started) / 1000)} seconds`);
  if (windows) {
    const login = await fetch('http://127.0.0.1:8080/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'native-owner', password }),
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    const identity = await fetch('http://127.0.0.1:8080/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    assert.equal(identity.status, 200);
    assert.deepEqual((await identity.json()).grants, [
      { repository: 'releases', permissions: ['read', 'write'] },
    ]);
    await assert.rejects(access(ownerFile), /ENOENT/, 'Consumed password file must be deleted');
  }
  const configuration = JSON.parse(await read(join(root, 'config/runtime.json')));
  assert.ok(configuration.DEPOT_DATABASE_URL.includes('127.0.0.1:54329/depot'));
  const pg = windows ? join(root, 'runtime/postgres/bin/psql.exe') : 'psql';
  const restricted = execFileSync(
    pg,
    ['-X', '-At', '-c', 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user'],
    {
      env: {
        ...env,
        PGHOST: '127.0.0.1',
        PGPORT: '54329',
        PGUSER: 'depot',
        PGDATABASE: 'depot',
        PGPASSWORD: new URL(configuration.DEPOT_DATABASE_URL).password,
      },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(restricted.trim(), 'f');
  const before = await read(join(root, 'config/runtime.json'));
  const ownerBefore = await read(join(root, 'database/owner-password'));
  // Re-running the same installer is repair, not credential/data replacement.
  if (windows)
    run(join(output, 'Depot-Setup-x64.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
  else run('sudo', ['apt-get', 'install', '--reinstall', '-y', join(output, 'Depot-amd64.deb')]);
  assert.equal(await read(join(root, 'config/runtime.json')), before);
  assert.equal(await read(join(root, 'database/owner-password')), ownerBefore);
  if (windows) {
    // Simulate a concurrent updater: the EXE must return failure without stopping healthy services.
    const lock = join(root, 'operation.lock');
    await writeFile(lock, 'native acceptance conflict', { flag: 'wx' });
    try {
      assert.throws(
        () =>
          run(join(output, 'Depot-Setup-x64.exe'), [
            '/VERYSILENT',
            '/SUPPRESSMSGBOXES',
            '/NORESTART',
          ]),
        (error) => error.status === 1,
      );
    } finally {
      await unlink(lock);
    }
    assert.equal(
      (
        await fetch('http://127.0.0.1:8080/health/ready', {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      200,
    );
  }
  console.log(
    `Native lifecycle checks completed in ${Math.round((Date.now() - started) / 1000)} seconds`,
  );
} catch (error) {
  if (windows) {
    try {
      console.error((await readFile(join(temporary, 'setup.log'), 'utf8')).slice(-12000));
    } catch (failure) {
      if (failure.code !== 'ENOENT') console.error('Cannot read setup diagnostic');
    }
    for (const name of [
      'bootstrap.log',
      'database/depot-database.err.log',
      'database/depot-database.wrapper.log',
    ]) {
      try {
        console.error(
          (await read(join(root, name)))
            .slice(-16000)
            .replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]')
            .replace(/\b[a-f0-9]{40,}\b/gi, '[secret]'),
        );
      } catch (failure) {
        if (failure.code !== 'ENOENT') console.error('Cannot read installer diagnostic');
      }
    }
  } else
    execFileSync(
      'sudo',
      ['journalctl', '-u', 'depot-database', '-u', 'depot-api', '-n', '80', '--no-pager'],
      { stdio: 'inherit' },
    );
  throw error;
} finally {
  if (windows) {
    const uninstaller = join(
      process.env.ProgramW6432 ?? process.env.ProgramFiles,
      'ProAnima/Depot/unins000.exe',
    );
    try {
      await access(uninstaller);
      run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } else run('sudo', ['apt-get', 'remove', '-y', 'proanima-depot']);
}
await read(join(root, 'database/cluster/PG_VERSION'));
await read(join(root, 'config/runtime.json'));
if (!windows) await exerciseRpm(output);
console.log(
  'Native installer, restricted database role, owner login and data-preserving uninstall passed',
);

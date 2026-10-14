import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  canListen,
  chooseDatabasePort,
  configureDatabase,
  databasePortCandidates,
  databaseSettings,
  ownerPassword,
} from '../apps/deploy/dist/managed-database.js';
import { initialize } from '../apps/deploy/dist/initialize.js';
import { deploymentHelp } from '../apps/deploy/dist/help.js';

test('managed database credentials isolate cluster ownership, use SCRAM bootstrap and refuse replacement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-managed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql', 'pg_isready'])
    await writeFile(join(bin, name + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  assert.equal(await databaseSettings(root), null);
  const url = new URL(await configureDatabase(root, bin));
  assert.equal(url.hostname, '127.0.0.1');
  // A free port of the candidates, recorded for every service that starts the database.
  assert.ok(databasePortCandidates().includes(Number(url.port)), url.port);
  assert.equal(url.username, 'arkvory');
  assert.match(url.password, /^[a-f0-9]{64}$/);
  assert.notEqual(await ownerPassword(root), url.password);
  assert.match(
    await readFile(join(root, 'database/bootstrap.sql'), 'utf8'),
    /NOSUPERUSER NOCREATEDB NOCREATEROLE/,
  );
  await assert.rejects(configureDatabase(root, bin), /EEXIST/);
  assert.deepEqual(await databaseSettings(root), { bin, port: Number(url.port) });
  await assert.rejects(configureDatabase(root, 'relative'), /Invalid/);
  // Installations made before the choice keep their port 54329.
  await writeFile(join(root, 'database/settings.json'), JSON.stringify({ bin, port: 54329 }));
  assert.deepEqual(await databaseSettings(root), { bin, port: 54329 });
  for (const port of [80, 70000, '54329', 1.5]) {
    await writeFile(join(root, 'database/settings.json'), JSON.stringify({ bin, port }));
    await assert.rejects(databaseSettings(root), /Invalid/, String(port));
  }
});

test('managed database selection cannot replace an external URL or Compose database', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-managed-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config.json');
  await writeFile(
    config,
    JSON.stringify({ ARKVORY_DATABASE_URL: 'postgresql://external/arkvory' }),
  );
  await assert.rejects(initialize(root, { mode: 'windows' }, config, root), /cannot replace/);
  await assert.rejects(initialize(root, { mode: 'compose' }, undefined, root), /cannot replace/);
  assert.match(deploymentHelp(), /--database-bin/);
  assert.match(deploymentHelp(), /--owner-file/);
});

test('the database port avoids the range Windows reserves at boot and skips a taken port', async (t) => {
  // Hyper-V and WinNAT reserve blocks of 49152-65535 at boot: never a new port there on Windows.
  const windows = databasePortCandidates('win32');
  assert.ok(windows.length >= 10 && windows.every((port) => port >= 1024 && port < 49152));
  assert.equal(databasePortCandidates('linux')[0], 54329, 'Linux keeps the established port first');
  const taken = createServer();
  taken.listen({ host: '127.0.0.1', port: 0 });
  await once(taken, 'listening');
  t.after(() => taken.close());
  const busy = taken.address().port;
  assert.equal(await canListen(busy), false);
  assert.equal(await chooseDatabasePort([busy, busy + 1], async (port) => port !== busy), busy + 1);
  await assert.rejects(
    chooseDatabasePort([busy], async () => false),
    /No port for the managed database/,
  );
});

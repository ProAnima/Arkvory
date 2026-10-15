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
  chooseManagedPort,
  configureDatabase,
  databasePortCandidates,
  databaseSettings,
  keepPortExcluded,
  ownerPassword,
  portExclusionMarker,
} from '../apps/deploy/dist/managed-database.js';
import { excludedRanges, reservePort } from '../apps/deploy/dist/port-reservation.js';
import { DeploymentCommandFailed } from '../apps/deploy/dist/process.js';
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
  // Never netsh from a unit test: the choice is injected, the Windows exclusion tested below.
  const choose = async () => ({ port: 45331, owned: true });
  const url = new URL(await configureDatabase(root, bin, choose));
  assert.equal(url.hostname, '127.0.0.1');
  // A free port of the candidates, recorded for every service that starts the database.
  assert.equal(url.port, '45331');
  assert.equal(await readFile(join(root, portExclusionMarker), 'utf8'), '45331');
  assert.equal(url.username, 'arkvory');
  assert.match(url.password, /^[a-f0-9]{64}$/);
  assert.notEqual(await ownerPassword(root), url.password);
  assert.match(
    await readFile(join(root, 'database/bootstrap.sql'), 'utf8'),
    /NOSUPERUSER NOCREATEDB NOCREATEROLE/,
  );
  await assert.rejects(configureDatabase(root, bin, choose), /EEXIST/);
  assert.deepEqual(await databaseSettings(root), { bin, port: Number(url.port) });
  await assert.rejects(configureDatabase(root, 'relative', choose), /Invalid/);
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

/** netsh with an in-memory exclusion table; `refuse` makes `add` fail like a port in use. */
function exclusions(rows, refuse = new Set()) {
  const added = [];
  return {
    added,
    show: async () =>
      [
        'Protocol tcp Port Exclusion Ranges',
        '',
        'Start Port    End Port',
        '----------    --------',
        ...rows.map(
          ([start, end, mark]) =>
            `${start}`.padStart(10) + `${end}`.padStart(12) + (mark ? '     *' : ''),
        ),
        ...added.map((port) => `${port}`.padStart(10) + `${port}`.padStart(12) + '     *'),
        '',
        '* - Administered port exclusions.',
      ].join('\r\n'),
    add: async (port) => {
      if (refuse.has(port)) throw new DeploymentCommandFailed(1);
      added.push(port);
    },
  };
}

test('the exclusion listing is read by its rows, whatever the language of its headers', () => {
  const listing =
    'Bereich der Portausschlüsse\r\n\r\n  Startport  Endport\r\n      5357        5357\r\n     50000       50059     *\r\n\r\n* - Verwaltete Portausschlüsse.';
  assert.deepEqual(excludedRanges(listing), [
    { start: 5357, end: 5357, administered: false },
    { start: 50000, end: 50059, administered: true },
  ]);
  assert.deepEqual(excludedRanges(''), []);
});

test('a port is excluded unless Windows reserved it or an administrator already excluded it', async () => {
  const table = exclusions(
    [
      [49700, 49799],
      [45300, 45330, true],
    ],
    new Set([45340]),
  );
  assert.equal(await reservePort(49750, table), 'system');
  assert.equal(await reservePort(45329, table), 'present');
  assert.equal(await reservePort(45340, table), 'refused');
  assert.equal(await reservePort(45335, table), 'added');
  assert.deepEqual(table.added, [45335]);
  assert.equal(await reservePort(45335, table), 'present', 'adding again is never attempted');
  const broken = { show: async () => '', add: async () => Promise.reject(new Error('spawn')) };
  await assert.rejects(
    reservePort(45335, broken),
    /spawn/,
    'only a refusal of netsh is an outcome',
  );
});

test('on Windows the chosen port is the first free one that can also be excluded', async () => {
  const table = exclusions(
    [
      [45329, 45329],
      [45331, 45331, true],
    ],
    new Set([45332]),
  );
  const free = async (port) => port !== 45330;
  // 45329 Windows reserved, 45330 in use, 45331 excluded by someone else.
  assert.deepEqual(await chooseManagedPort('win32', free, table), { port: 45331, owned: false });
  const own = exclusions([[45329, 45331]], new Set([45332]));
  assert.deepEqual(await chooseManagedPort('win32', free, own), { port: 45333, owned: true });
  assert.deepEqual(own.added, [45333]);
  const untouched = exclusions([]);
  assert.deepEqual(await chooseManagedPort('linux', async () => true, untouched), {
    port: 54329,
    owned: false,
  });
  assert.deepEqual(untouched.added, [], 'no exclusions outside Windows');
  await assert.rejects(
    chooseManagedPort('win32', async () => true, exclusions([[1024, 49151]])),
    /No port for the managed database/,
  );
});

test('repair restores a missing exclusion and claims only the one it added', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-port-exclusion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'database'));
  const marker = join(root, portExclusionMarker);
  // Kept by an administrator, Windows reserved or refused: reported, never claimed, never fatal.
  await keepPortExcluded(root, 45329, exclusions([[45329, 45329, true]]));
  await keepPortExcluded(root, 54329, exclusions([[54300, 54399]]));
  await keepPortExcluded(root, 54329, exclusions([], new Set([54329])));
  await assert.rejects(readFile(marker), /ENOENT/);
  const table = exclusions([]);
  await keepPortExcluded(root, 45329, table);
  assert.deepEqual(table.added, [45329]);
  assert.equal(await readFile(marker, 'utf8'), '45329');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  configureDatabase,
  databaseSettings,
  ownerPassword,
} from '../apps/deploy/dist/managed-database.js';
import { initialize } from '../apps/deploy/dist/initialize.js';
import { deploymentHelp } from '../apps/deploy/dist/help.js';

test('managed database credentials isolate cluster ownership, use SCRAM bootstrap and refuse replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-managed-'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql', 'pg_isready'])
    await writeFile(join(bin, name + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  assert.equal(await databaseSettings(root), null);
  const url = new URL(await configureDatabase(root, bin));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '54329');
  assert.equal(url.username, 'arkvory');
  assert.match(url.password, /^[a-f0-9]{64}$/);
  assert.notEqual(await ownerPassword(root), url.password);
  assert.match(
    await readFile(join(root, 'database/bootstrap.sql'), 'utf8'),
    /NOSUPERUSER NOCREATEDB NOCREATEROLE/,
  );
  await assert.rejects(configureDatabase(root, bin), /EEXIST/);
  assert.deepEqual(await databaseSettings(root), { bin, port: 54329 });
  await assert.rejects(configureDatabase(root, 'relative'), /Invalid/);
  await writeFile(join(root, 'database/settings.json'), JSON.stringify({ bin, port: 5432 }));
  await assert.rejects(databaseSettings(root), /Invalid/);
});

test('managed database selection cannot replace an external URL or Compose database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-managed-conflict-'));
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

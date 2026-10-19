import { PostgresModuleDataCoordinator } from '../../packages/infrastructure/dist/module-data-coordinator.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModuleRemoval,
  ModuleUnlinkAdmission,
  PostgresContentPins,
  openModuleData,
} from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { publish } from './backup-fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';

const options = { durable: false, exclusive: false };
async function write(data, name, value) {
  const sink = await data.create(name, options);
  await sink.write(Buffer.from(value));
  await sink.close();
}

test('data replacement respects global reader pins and backup pins of another upload', async (t) => {
  const f = await setup(t);
  const root = await mkdtemp(join(tmpdir(), 'arkvory-data-pins-'));
  t.after(() => removeTestDirectory(root));
  const coordinator = new PostgresModuleDataCoordinator(f.catalog.sessions);
  const pins = new PostgresContentPins(f.catalog.sessions);
  t.after(() => pins.close());
  const admission = new ModuleUnlinkAdmission(f.catalog.sessions);
  const removal = new ModuleRemoval();
  const opened = await openModuleData({
    coordinator,
    dataDirectory: root,
    moduleId: 'test-store',
    quota: { bytes: 100, files: 10 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    requireRemoval: () => removal.require(),
  });
  const { data } = opened.directory;
  try {
    const replace = () =>
      admission.run((check) => removal.collect(check, () => write(data, 'published', 'new')));
    await write(data, 'published', 'old');
    const pin = await pins.acquire(randomUUID());
    try {
      await assert.rejects(replace(), { code: 'busy' });
      await assert.rejects(write(data, 'published', 'bypass'), { code: 'busy' });
    } finally {
      await pin.release();
    }
    const blob = await publish(f);
    const job = randomUUID();
    await f.catalog.pool.query(
      `INSERT INTO arkvory_backup_jobs
    (id,kind,state,phase,idempotency_key,vault_id,point_id)
    VALUES($1,'capture','completed','done',$1,$2,$3)`,
      [job, randomUUID(), randomUUID()],
    );
    await f.catalog.pool.query('INSERT INTO arkvory_backup_pins(upload_id,job_id) VALUES($1,$2)', [
      blob.id,
      job,
    ]);
    await assert.rejects(replace(), { code: 'busy' });
    await write(data, 'other', 'other');
    await assert.rejects(data.rename('other', 'published'), { code: 'busy' });
    await f.catalog.pool.query('DELETE FROM arkvory_backup_pins WHERE job_id=$1', [job]);
    await replace();
    const chunks = [];
    for await (const chunk of data.read('published')) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'new');
  } finally {
    try {
      await opened.close();
    } finally {
      await coordinator.close();
      await pins.close();
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseKeys } from '@proanima/depot-infrastructure';
import { initialize } from '../../apps/deploy/dist/initialize.js';
import { healthReady } from '../../apps/deploy/dist/health.js';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, descriptor, base } from './fixture.mjs';

test('generated deployment health credential authenticates readiness without artifact or administrator access', async (t) => {
  const f = await setup(t);
  const root = await mkdtemp(join(tmpdir(), 'depot-deploy-health-'));
  t.after(() => removeTestDirectory(root));
  const input = join(root, 'input.json');
  await writeFile(input, JSON.stringify({ DEPOT_DATABASE_URL: f.config.databaseUrl }), {
    mode: 0o600,
  });
  await initialize(root, { mode: 'systemd', current: { version: '1.0.0' } }, input);
  f.config.keys = parseKeys(JSON.parse(await readFile(join(root, 'config/keys.json'), 'utf8')));
  await f.restart();
  const tokenFile = join(root, 'config/health-token.txt');
  const token = await readFile(tokenFile, 'utf8');
  assert.notEqual(token, await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8'));
  const address = await f.listen();
  assert.equal(await healthReady(new URL(address).port, tokenFile), true);
  assert.equal((await f.app.inject({ url: '/health/ready' })).statusCode, 401);
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() };
  const denied = await f.app.inject({
    method: 'POST',
    url: base + '/uploads',
    headers,
    payload: descriptor(Buffer.from('denied')),
  });
  assert.equal(denied.statusCode, 403);
  assert.equal((await f.app.inject({ url: '/api/v1/users', headers })).statusCode, 403);
});

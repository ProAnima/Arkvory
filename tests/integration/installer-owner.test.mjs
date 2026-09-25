import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DepotClient } from '@proanima/depot-sdk';
import { createOwner } from '../../apps/deploy/dist/owner.js';
import { setup } from './fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';

test('installer creates a real owner, consumes the private password file and refuses account replacement', async (t) => {
  const fixture = await setup(t);
  const base = await fixture.listen();
  const root = await mkdtemp(join(tmpdir(), 'depot-owner-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'config'));
  await writeFile(
    join(root, 'config/runtime.json'),
    JSON.stringify({ DEPOT_PORT: new URL(base).port }),
  );
  await writeFile(join(root, 'config/bootstrap-token.txt'), fixture.headers.authorization.slice(7));
  const passwordFile = join(root, 'owner.json');
  await writeFile(
    passwordFile,
    JSON.stringify({ name: 'installer-owner', password: 'test-owner-password-123' }),
  );
  await createOwner(root, passwordFile);
  await assert.rejects(access(passwordFile), /ENOENT/);
  const client = new DepotClient(base, () => '');
  const session = await client.login('installer-owner', 'test-owner-password-123');
  assert.equal(session.account.administrator, true);
  await writeFile(
    passwordFile,
    JSON.stringify({ name: 'replacement', password: 'other-password-123' }),
  );
  await assert.rejects(createOwner(root, passwordFile), /already exists/);
  await access(passwordFile);
  assert.equal(
    (await new DepotClient(base, () => fixture.headers.authorization.slice(7)).users()).length,
    1,
  );
});

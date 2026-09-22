import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { removeTestDirectory } from './helpers.mjs';

test('local bootstrap generates private credentials and refuses to replace them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-bootstrap-'));
  t.after(() => removeTestDirectory(directory));
  const script = resolve('scripts/init-local.mjs');
  execFileSync(process.execPath, [script], { cwd: directory, stdio: 'pipe', windowsHide: true });
  const token = await readFile(join(directory, 'data/local-token.txt'), 'utf8');
  const keys = JSON.parse(await readFile(join(directory, 'data/service-keys.json'), 'utf8'));
  assert.equal(token.length, 64);
  assert.equal(keys[0].sha256, createHash('sha256').update(token).digest('hex'));
  assert.throws(() =>
    execFileSync(process.execPath, [script], { cwd: directory, stdio: 'pipe', windowsHide: true }),
  );
  assert.equal(await readFile(join(directory, 'data/local-token.txt'), 'utf8'), token);
});

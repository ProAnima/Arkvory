import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setup } from './fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';

const run = (args, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    p.stdout.on('data', (b) => (output += b));
    p.stderr.on('data', (b) => (output += b));
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code, output }));
  });
test('directory import dry run, verified transfer and repeat are idempotent', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  const source = await mkdtemp(join(tmpdir(), 'arkvory-import-'));
  t.after(() => removeTestDirectory(source));
  await writeFile(join(source, 'hello.bin'), 'imported bytes');
  const token = join(f.directory, 'token');
  const journal = join(f.directory, 'import.jsonl');
  await writeFile(token, f.headers.authorization.slice(7));
  const env = {
    ARKVORY_BASE_URL: address,
    ARKVORY_REPOSITORY: 'releases',
    ARKVORY_TOKEN_FILE: token,
    ARKVORY_IMPORT_JOURNAL: journal,
  };
  const dry = await run(['scripts/import.mjs', source], env);
  assert.equal(dry.code, 0, dry.output);
  assert.equal(JSON.parse(dry.output).size, '14');
  assert.equal((await f.catalog.list('releases', undefined, 10)).length, 0);
  for (let i = 0; i < 2; i++) {
    const result = await run(['scripts/import.mjs', source, '--apply'], env);
    assert.equal(result.code, 0, result.output);
  }
  assert.equal((await f.catalog.list('releases', undefined, 10)).length, 1);
  const entries = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, entries[1].id);
  await f.app.close();
  const scrub = await run(['apps/worker/dist/scrub.js'], {
    ARKVORY_DATABASE_URL: f.config.databaseUrl,
    ARKVORY_DATA_DIR: f.directory,
  });
  assert.equal(scrub.code, 0, scrub.output);
  assert.equal(JSON.parse(scrub.output).checked, 1);
});

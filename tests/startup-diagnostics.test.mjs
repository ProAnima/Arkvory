import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTestDirectory } from './helpers.mjs';

const password = 'StartupSecretPassword42';
// Port 9 (discard) is closed on test hosts: the connection is refused without a server.
const databaseUrl = `postgresql://arkvory:${password}@127.0.0.1:9/arkvory`;

function run(entry, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Startup did not fail within 30 s'));
    }, 30000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const records = output
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));
      resolve({ code, output, records });
    });
  });
}

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-startup-'));
  t.after(() => removeTestDirectory(root));
  return root;
}

test('worker startup failure reports a safe reason and errno without the database secret', async (t) => {
  const root = await directory(t);
  const keys = join(root, 'keys.json');
  await writeFile(keys, '[]');
  const result = await run('apps/worker/dist/main.js', {
    ARKVORY_DATABASE_URL: databaseUrl,
    ARKVORY_DATA_DIR: root,
    ARKVORY_KEYS_FILE: keys,
  });
  assert.equal(result.code, 1);
  const failure = result.records.find((r) => r.code === 'worker.unavailable');
  assert.ok(failure, result.output);
  assert.equal(failure.reason, 'dependency unavailable');
  assert.ok(failure.errno || failure.errorName, result.output);
  assert.doesNotMatch(result.output, new RegExp(`${password}|postgresql://`));
});

test('worker configuration failure names the missing variable', async () => {
  const result = await run('apps/worker/dist/main.js', { ARKVORY_DATABASE_URL: databaseUrl });
  assert.equal(result.code, 1);
  const failure = result.records.find((r) => r.code === 'worker.unavailable');
  assert.equal(failure?.reason, 'ARKVORY_KEYS_FILE is required', result.output);
  assert.doesNotMatch(result.output, new RegExp(password));
});

test('API startup failure is a structured line naming the variable, not its value', async (t) => {
  const root = await directory(t);
  for (const [content, reason] of [
    [undefined, 'Cannot read ARKVORY_KEYS_FILE (ENOENT)'],
    ['{"key": "', 'ARKVORY_KEYS_FILE is not valid JSON'],
    ['[]', 'Key file must contain between 1 and 1000 service keys'],
  ]) {
    const keys = join(root, 'keys.json');
    if (content !== undefined) await writeFile(keys, content);
    const result = await run('apps/api/dist/main.js', {
      ARKVORY_DATABASE_URL: databaseUrl,
      ARKVORY_DATA_DIR: root,
      ARKVORY_KEYS_FILE: keys,
    });
    assert.equal(result.code, 1);
    const failure = result.records.find((r) => r.code === 'startup.failed');
    assert.equal(failure?.component, 'api', result.output);
    assert.equal(failure.reason, reason);
    assert.match(result.output, /Arkvory startup failed/);
    assert.doesNotMatch(result.output, new RegExp(`${password}|postgresql://|keys\\.json`));
  }
});

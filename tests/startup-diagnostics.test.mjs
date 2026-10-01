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

function run(entry, env, preload) {
  // A data: URL preload injects a fault into the real entry point without a helper file.
  const args = preload ? [`--import=data:text/javascript,${encodeURIComponent(preload)}`] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, entry], {
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
    // 'close' waits for stdio: 'exit' can precede the last structured lines.
    child.once('close', (code) => {
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
    assert.equal(failure?.service, 'api', result.output);
    assert.equal(failure.component, 'process');
    assert.equal(failure.reason, reason);
    assert.match(result.output, /Arkvory startup failed/);
    assert.doesNotMatch(result.output, new RegExp(`${password}|postgresql://|keys\\.json`));
  }
});

test('invalid log level and unreachable migration database fail with structured records', async (t) => {
  const root = await directory(t);
  const keys = join(root, 'keys.json');
  await writeFile(
    keys,
    '[{"id":"k","sha256":"' + 'a'.repeat(64) + '","repositories":[],"permissions":[]}]',
  );
  const api = await run('apps/api/dist/main.js', {
    ARKVORY_DATABASE_URL: databaseUrl,
    ARKVORY_DATA_DIR: root,
    ARKVORY_KEYS_FILE: keys,
    ARKVORY_LOG_LEVEL: 'verbose',
  });
  assert.equal(api.code, 1);
  assert.equal(
    api.records.find((r) => r.code === 'startup.failed')?.reason,
    'Invalid ARKVORY_LOG_LEVEL',
    api.output,
  );
  const migration = await run('apps/api/dist/migrate.js', { ARKVORY_DATABASE_URL: databaseUrl });
  assert.equal(migration.code, 1);
  const failure = migration.records.find((r) => r.code === 'migrate.failed');
  assert.ok(failure, migration.output);
  assert.equal(failure.service, 'migrate');
  assert.equal(failure.component, 'migrate');
  assert.equal(failure.reason, 'dependency unavailable');
  assert.match(migration.output, /Arkvory database migration failed/);
  assert.doesNotMatch(migration.output, new RegExp(`${password}|postgresql://`));
});

// Fires once the entry point installed its handlers, independent of startup timing.
const fault = (kind) => `
  const timer = setInterval(() => {
    if (process.listenerCount('uncaughtException') === 0) return;
    clearInterval(timer);
    const error = new Error('fault at postgresql://arkvory:${password}@db.internal/arkvory token=${password}');
    if ('${kind}' === 'rejection') Promise.reject(error);
    else setTimeout(() => { throw error; });
  }, 5);`;

for (const [entry, kind, origin] of [
  ['apps/api/dist/main.js', 'rejection', 'unhandledRejection'],
  ['apps/worker/dist/main.js', 'exception', 'uncaughtException'],
])
  test(`${entry} logs an unhandled ${kind} as process.unhandled and exits 1`, async (t) => {
    const root = await directory(t);
    const keys = join(root, 'keys.json');
    await writeFile(keys, '[]');
    const result = await run(
      entry,
      { ARKVORY_DATABASE_URL: databaseUrl, ARKVORY_DATA_DIR: root, ARKVORY_KEYS_FILE: keys },
      fault(kind),
    );
    assert.equal(result.code, 1, result.output);
    const crash = result.records.find((r) => r.code === 'process.unhandled');
    assert.ok(crash, result.output);
    assert.equal(crash.level, 'error');
    assert.equal(crash.component, 'process');
    assert.equal(crash.origin, origin);
    assert.equal(crash.errorName, 'Error');
    assert.match(crash.reason, /^fault at <redacted-url> token=<redacted>$/);
    assert.ok(crash.pid > 0 && crash.hostname && crash.version, result.output);
    assert.doesNotMatch(result.output, new RegExp(`${password}|postgresql://|db\\.internal`));
  });

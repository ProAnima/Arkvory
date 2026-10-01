import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLine, redactSecrets } from '../apps/deploy/dist/output.js';
import { rotateLog, runWithLogFile } from '../apps/deploy/dist/log-file.js';
import { removeTestDirectory } from './helpers.mjs';

test('deploy lines carry an ISO timestamp, a level and one redacted line', () => {
  const now = new Date('2026-10-01T12:34:56.789Z');
  assert.equal(
    formatLine('info', 'Already current', now),
    '2026-10-01T12:34:56.789Z INFO Already current',
  );
  assert.equal(formatLine('warning', 'x', now), '2026-10-01T12:34:56.789Z WARN x');
  assert.equal(
    formatLine('error', 'line one\r\nline two', now),
    '2026-10-01T12:34:56.789Z ERROR line one line two',
  );
  assert.ok(formatLine('error', 'y'.repeat(10000), now).length < 4100);
});

test('one redaction helper removes URLs with credentials, headers and known token formats', () => {
  const github = 'ghp_' + 'A1b2C3d4'.repeat(5);
  const fineGrained = 'github_pat_' + '11ABCDEFG0'.repeat(4);
  const service = 'arkvory_0f8fad5b-d9cb-469f-a165-70867728950e.' + 'Zm9vYmFy'.repeat(5);
  const cases = [
    [
      'Cannot connect postgresql://arkvory:hunter2@db.internal:5432/arkvory',
      'hunter2|db\\.internal',
    ],
    ['GET https://deploy:s3cr3t@releases.example.com/a failed', 's3cr3t|deploy:'],
    ['Authorization: Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
    ['proxy-authorization=Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['retry with bearer eyJhbGciOiJIUzI1NiJ9.e30.sig', 'eyJhbGci'],
    [`token file contained ${github}`, github],
    [`fine grained ${fineGrained}`, fineGrained],
    [`service key ${service}`, 'Zm9vYmFy|0f8fad5b'],
    ['session dps_abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnop'],
    [
      'password=correct-horse token: "quoted value" api_key=abc123',
      'correct-horse|quoted value|abc123',
    ],
    ['bootstrap ' + 'a1'.repeat(32), '(a1){8}'],
    ['standalone eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', 'eyJ'],
  ];
  for (const [input, secret] of cases) {
    const output = redactSecrets(input);
    assert.doesNotMatch(output, new RegExp(secret), `${input} -> ${output}`);
  }
  assert.equal(
    redactSecrets('GET https://deploy:s3cr3t@releases.example.com/a'),
    'GET https://<redacted>@releases.example.com/a',
  );
  // Ordinary operator text, paths and release identifiers stay readable.
  for (const kept of [
    'Updated to 1.4.2',
    'C:\\ProgramData\\ProAnima\\Arkvory\\releases\\1.4.2\\deploy\\schedule-windows.ps1',
    '/var/lib/proanima/arkvory/releases/staging/area/with/many/segments/1.4.2/launcher.mjs',
    'https://github.com/ProAnima/Arkvory/releases/tag/v1.4.2',
    'stage .stage-0f8fad5b-d9cb-469f-a165-70867728950e failed',
  ])
    assert.equal(redactSecrets(kept), kept);
});

test('size rotation keeps a bounded number of files and removes the oldest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-log-'));
  t.after(() => removeTestDirectory(directory));
  const file = join(directory, 'updater.log');
  await rotateLog(file, 10, 3);
  assert.deepEqual(await readdir(directory), [], 'a missing log is not created');
  for (let run = 0; run < 6; run++) {
    await rotateLog(file, 10, 3);
    await writeFile(file, `run-${String(run)}-0123456789`);
  }
  assert.deepEqual((await readdir(directory)).sort(), [
    'updater.log',
    'updater.log.1',
    'updater.log.2',
  ]);
  assert.equal(await readFile(file, 'utf8'), 'run-5-0123456789');
  assert.equal(await readFile(`${file}.1`, 'utf8'), 'run-4-0123456789');
  assert.equal(await readFile(`${file}.2`, 'utf8'), 'run-3-0123456789');
  await writeFile(file, 'small');
  await rotateLog(file, 10, 3);
  assert.equal(await readFile(file, 'utf8'), 'small', 'below the threshold nothing moves');
  await assert.rejects(rotateLog(file, 0, 3), /Invalid log rotation limits/);
});

test('captured runs append child stdout and stderr to the log and return the exit code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-log-'));
  t.after(() => removeTestDirectory(directory));
  const file = join(directory, 'logs', 'updater.log');
  const script = "console.log('out line'); console.error('err line'); process.exitCode = 3;";
  assert.equal(await runWithLogFile(file, process.execPath, ['-e', script]), 3);
  assert.equal(await runWithLogFile(file, process.execPath, ['-e', "console.log('second')"]), 0);
  const text = await readFile(file, 'utf8');
  assert.match(text, /out line/);
  assert.match(text, /err line/);
  assert.match(text, /second/);
  const blocked = join(directory, 'not-a-directory');
  await writeFile(blocked, 'file');
  assert.equal(
    await runWithLogFile(join(blocked, 'updater.log'), process.execPath, ['-e', '0']),
    undefined,
    'an unusable log path lets the caller run without capture',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { licenceKeyDigest } from '@proanima/arkvory-infrastructure';
import { INSTALLATION, licenceSetup } from './licence-fixture.mjs';

const run = promisify(execFile);
const entry = fileURLToPath(new URL('../../apps/worker/dist/license.js', import.meta.url));

/** `arkvory license …` as the launcher runs it: the release entry with the runtime environment. */
async function license(f, ...args) {
  const env = {
    ...process.env,
    ARKVORY_DATABASE_URL: f.url,
    ARKVORY_LICENSE_DIR: f.directory,
    ARKVORY_HUB_FILE: join(f.root, 'hub.json'),
    ARKVORY_INSTALL_ID_FILE: join(f.root, 'install-id'),
  };
  try {
    const { stdout, stderr } = await run(process.execPath, [entry, ...args], {
      env,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function prepared(t) {
  const f = await licenceSetup(t);
  await writeFile(
    join(f.root, 'hub.json'),
    JSON.stringify({
      format: 1,
      url: f.hub.url,
      project: 'arkvory',
      channel: 'stable',
      statistics: false,
    }),
  );
  await writeFile(join(f.root, 'install-id'), `${INSTALLATION}\n`);
  await writeFile(join(f.root, 'key.txt'), `${f.key}\n`);
  return f;
}

test('license status works on an installation without licences', async (t) => {
  const f = await prepared(t);
  const text = await license(f, 'status');
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /No licence: every function of the free core works without one/);
  const json = await license(f, 'status', '--json');
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).licenses, []);
  assert.equal(f.hub.requests.length, 0);
  const usage = await license(f, 'remove');
  assert.equal(usage.code, 1);
  assert.match(usage.stderr, /^Usage: arkvory license/);
});

test('activate reads the key from its file, sends it once and prints or keeps it nowhere', async (t) => {
  const f = await prepared(t);
  await writeFile(
    join(f.root, 'typo.txt'),
    `${f.key.slice(0, -1)}${f.key.endsWith('0') ? '1' : '0'}\n`,
  );
  const typo = await license(f, 'activate', '--key-file', join(f.root, 'typo.txt'));
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /holds no valid licence key/);
  assert.equal(f.hub.requests.length, 0, 'a mistyped key never leaves the host');

  f.hub.licence(f.key);
  // The stub signs with a test root: the release trusts only the built-in licence root.
  const result = await license(f, 'activate', '--key-file', join(f.root, 'key.txt'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Licence refused: answer_invalid:signature_unknown_key/);
  const [call] = f.hub.requests;
  assert.equal(call.body.key, f.key);
  assert.equal(call.body.installId, INSTALLATION);
  const secret = [...f.hub.activations.values()][0].secret;
  for (const output of [result.stdout, result.stderr, typo.stdout, typo.stderr]) {
    assert.equal(output.includes(f.key), false);
    assert.equal(output.includes(secret), false);
  }
  assert.deepEqual(await readdir(f.directory), [], 'no secret of a refused answer is kept');
  assert.equal(
    (await f.pool.query('SELECT count(*)::int AS n FROM arkvory_license_activations')).rows[0].n,
    0,
  );
});

test('request writes a file without the key; install refuses what the built-in root did not sign', async (t) => {
  const f = await prepared(t);
  const out = join(f.root, 'request.json');
  const made = await license(f, 'request', '--key-file', join(f.root, 'key.txt'), '--out', out);
  assert.equal(made.code, 0, made.stderr);
  const request = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(Object.keys(request).sort(), [
    'coreVersion',
    'format',
    'installId',
    'keySha256',
    'kind',
    'modules',
    'nonce',
    'requestedAt',
  ]);
  assert.equal(request.keySha256, licenceKeyDigest(f.key));
  assert.equal(JSON.stringify(request).includes(f.key), false);
  assert.equal(request.coreVersion, '0.0.0-dev', 'a development build names a semver for the hub');
  const again = await license(f, 'request', '--key-file', join(f.root, 'key.txt'), '--out', out);
  assert.equal(again.code, 1, 'an earlier request file is never overwritten');
  const pending = await license(f, 'status', '--json');
  assert.equal(JSON.parse(pending.stdout).pendingRequests, 1);

  const answer = join(f.root, 'answer.json');
  await writeFile(
    answer,
    f.authority.offlineToken({ nonce: request.nonce, installation: INSTALLATION }),
  );
  const installed = await license(f, 'install', answer);
  assert.equal(installed.code, 1);
  assert.match(installed.stderr, /signature_unknown_key/);
  assert.equal(f.hub.requests.length, 0, 'offline commands never use the network');
});

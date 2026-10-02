import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { configureMirror, fetchProbe, upstreamOrigin } from '../apps/deploy/dist/mirror-setup.js';
import { removeTestDirectory } from './helpers.mjs';

const release = { version: '1.0.0', commit: 'c', schema: 28, archiveSha256: 'a', setupSha256: 's' };
const key = 'arkvory_' + 'k'.repeat(40);

async function installation(t, mode = 'systemd') {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-mirror-setup-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify({ ARKVORY_PORT: '8080' }));
  const tokenFile = join(root, 'source.key');
  await writeFile(tokenFile, key + '\n');
  return { root, tokenFile, state: { mode, current: release } };
}

function services(fail = 0) {
  const calls = [];
  let ready = 0;
  return {
    calls,
    stop: async () => calls.push('stop'),
    start: async () => calls.push('start'),
    healthy: async () => {
      calls.push('healthy');
      if (++ready === fail) throw new Error('readiness failed');
    },
  };
}

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const attach = (tokenFile) => ({
  repository: 'releases',
  upstream: 'https://arkvory.example',
  tokenFile,
});

test('attaching checks the source with the key, writes the mirror and restarts', async (t) => {
  const { root, tokenFile, state } = await installation(t);
  const probes = [];
  const control = services();
  const outcome = await configureMirror(
    root,
    state,
    attach(tokenFile),
    control,
    async (...args) => {
      probes.push(args);
    },
  );
  assert.equal(outcome, 'attached');
  assert.deepEqual(probes, [['https://arkvory.example', 'releases', key]]);
  const mirrorsFile = join(root, 'config/mirrors/mirrors.json');
  assert.equal((await json(join(root, 'config/runtime.json'))).ARKVORY_MIRRORS_FILE, mirrorsFile);
  assert.deepEqual((await json(mirrorsFile)).mirrors, [
    {
      repository: 'releases',
      upstream: 'https://arkvory.example',
      sourceRepository: 'releases',
      tokenFile: join(root, 'config/mirrors/releases.token'),
    },
  ]);
  assert.equal((await readFile(join(root, 'config/mirrors/releases.token'), 'utf8')).trim(), key);
  assert.deepEqual(control.calls, ['stop', 'start', 'healthy']);
  // Detaching keeps the data and removes the setting, the key and the variable.
  assert.equal(await configureMirror(root, state, { detach: 'releases' }, services()), 'detached');
  assert.equal((await json(join(root, 'config/runtime.json'))).ARKVORY_MIRRORS_FILE, undefined);
  await assert.rejects(readFile(join(root, 'config/mirrors/releases.token')), { code: 'ENOENT' });
});

test('import mode keeps its stages and refuses invalid ones before any request', async (t) => {
  const { root, tokenFile, state } = await installation(t);
  await configureMirror(
    root,
    state,
    { ...attach(tokenFile), stages: ['release', 'hotfix'] },
    services(),
    async () => undefined,
  );
  const mirrors = await json(join(root, 'config/mirrors/mirrors.json'));
  assert.deepEqual(mirrors.mirrors[0].stages, ['release', 'hotfix']);
  for (const stages of [['Release'], [], ['a', 'a']])
    await assert.rejects(
      configureMirror(root, state, { ...attach(tokenFile), stages }, services(), async () =>
        assert.fail('no request'),
      ),
      /--mirror-stages/,
    );
});

test('Compose sees the files inside the containers through a generated mount', async (t) => {
  const { root, tokenFile, state } = await installation(t, 'compose');
  await configureMirror(root, state, attach(tokenFile), services(), async () => undefined);
  const runtime = await json(join(root, 'config/runtime.json'));
  assert.equal(runtime.ARKVORY_MIRRORS_FILE, '/run/arkvory/mirrors/mirrors.json');
  const mirrors = await json(join(root, 'config/mirrors/mirrors.json'));
  assert.equal(mirrors.mirrors[0].tokenFile, '/run/arkvory/mirrors/releases.token');
  const override = await readFile(join(root, 'config/compose.mirrors.yml'), 'utf8');
  assert.match(override, /\.\/config\/mirrors:\/run\/arkvory\/mirrors:ro/);
});

test('a refused source or a failed restart changes nothing', async (t) => {
  const { root, tokenFile, state } = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  const untouched = services();
  await assert.rejects(
    configureMirror(root, state, attach(tokenFile), untouched, async () => {
      throw new Error('The source refused /api/v1/capabilities (401)');
    }),
    /refused/,
  );
  assert.deepEqual(untouched.calls, [], 'nothing restarts before the source is verified');
  const failing = services(1);
  await assert.rejects(
    configureMirror(root, state, attach(tokenFile), failing, async () => undefined),
    /previous configuration is restored \(readiness failed\)/,
  );
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
  await assert.rejects(readFile(join(root, 'config/mirrors/mirrors.json')), { code: 'ENOENT' });
  assert.deepEqual(failing.calls, ['stop', 'start', 'healthy', 'stop', 'start', 'healthy']);
});

test('inputs are refused before any request: origin, repository, key file and source', async (t) => {
  const { root, tokenFile, state } = await installation(t);
  const never = async () => assert.fail('no request');
  for (const upstream of [
    'http://arkvory.example',
    'https://a.example/api',
    'https://u:p@a.example',
  ])
    assert.throws(() => upstreamOrigin(upstream), /origin/);
  assert.equal(upstreamOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  await assert.rejects(
    configureMirror(root, state, { ...attach(tokenFile), repository: 'Bad' }, services(), never),
    /--mirror/,
  );
  await assert.rejects(
    configureMirror(root, state, { ...attach('relative.key') }, services(), never),
    /absolute path/,
  );
  await assert.rejects(
    configureMirror(root, state, { detach: 'releases' }, services()),
    /not a mirrored/,
  );
  await configureMirror(root, state, attach(tokenFile), services(), async () => undefined);
  await assert.rejects(
    configureMirror(
      root,
      state,
      { ...attach(tokenFile), sourceRepository: 'other' },
      services(),
      never,
    ),
    /another source; detach it first/,
  );
});

test('the probe asks the source for the mirror feed with the key and never echoes the key', async (t) => {
  let mode = 'ok';
  const seen = [];
  const server = createServer((request, response) => {
    seen.push([request.url, request.headers.authorization]);
    if (mode === 'refused') return response.writeHead(401).end('{}');
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/api/v1/capabilities')
      return response.end(JSON.stringify({ features: mode === 'old' ? {} : { mirrorFeed: true } }));
    response.end(JSON.stringify({ items: [], head: '0', next: null }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const origin = `http://127.0.0.1:${String(server.address().port)}`;
  await fetchProbe(origin, 'releases', key);
  assert.deepEqual(seen, [
    ['/api/v1/capabilities', `Bearer ${key}`],
    ['/api/v1/repositories/releases/changes?limit=1', `Bearer ${key}`],
  ]);
  mode = 'refused';
  await assert.rejects(fetchProbe(origin, 'releases', key), (error) => {
    assert.match(error.message, /refused \/api\/v1\/capabilities \(401\)/);
    assert.ok(!error.message.includes(key));
    return true;
  });
  mode = 'old';
  await assert.rejects(fetchProbe(origin, 'releases', key), /without the mirror change feed/);
});

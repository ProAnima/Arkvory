import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ModuleCompute } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

async function fixture(t, code) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-compute-boundaries-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'files'));
  await writeFile(join(root, 'files/task.mjs'), code);
  const pool = new ModuleCompute(root, [{ name: 'task', entry: 'files/task.mjs' }], 30000);
  t.after(() => pool.close());
  return { root, pool };
}

test('compute copies a small Uint8Array and Buffer view without their huge backing stores', async (t) => {
  const { pool } = await fixture(t, 'export default input => input.buffer.byteLength;');
  const backing = new ArrayBuffer(17 * 1024 ** 2);
  for (const view of [new Uint8Array(backing, 15, 1), Buffer.from(backing, 12, 1)]) {
    assert.equal(await pool.run('task', view, new AbortController().signal), 1);
  }
});

test('close awaits a busy thread and rejects queued and aborted jobs without hanging', async (t) => {
  const { pool, root } = await fixture(
    t,
    "import { writeFileSync } from 'node:fs'; export default path => { writeFileSync(path, 'started'); while (true) {} };",
  );
  const marker = join(root, 'started');
  const running = assert.rejects(pool.run('task', marker, new AbortController().signal));
  const cancel = new AbortController();
  const cancelled = assert.rejects(pool.run('task', marker, cancel.signal));
  const queued = assert.rejects(pool.run('task', marker, new AbortController().signal));
  cancel.abort();
  // Wait for actual execution, so termination exercises a live task, not only startup.
  for (let attempt = 0; ; attempt++) {
    try {
      await access(marker);
      break;
    } catch {
      assert.ok(attempt < 500);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await pool.close();
  await Promise.all([running, cancelled, queued]);
  await pool.close();
  await assert.rejects(pool.run('task', marker, new AbortController().signal));
});

test('failed task stops its thread and the next queued task still runs', async (t) => {
  const { pool } = await fixture(
    t,
    "export default input => { if (input === 'fail') throw Error('failed'); return input; };",
  );
  const failed = assert.rejects(pool.run('task', 'fail', new AbortController().signal));
  const next = pool.run('task', 'ok', new AbortController().signal);
  await failed;
  assert.equal(await next, 'ok');
});

test('compute refuses an entry outside the signed package', async (t) => {
  const { root } = await fixture(t, 'export default input => input;');
  await writeFile(join(root, 'outside.mjs'), 'export default () => 42;');
  const pool = new ModuleCompute(join(root, 'files'), [
    { name: 'escape', entry: '../outside.mjs' },
  ]);
  t.after(() => pool.close());
  await assert.rejects(pool.run('escape', null, new AbortController().signal));
});

test(
  'shipped worker bootstrap refuses ancestor dependencies before evaluating task libraries',
  { timeout: 15000 },
  async (t) => {
    const { root } = await fixture(t, 'export default input => input;');
    const release = join(root, 'release');
    const infra = join(release, 'packages/infrastructure');
    await mkdir(infra, { recursive: true });
    await writeFile(join(infra, 'package.json'), '{"type":"module"}');
    await cp(resolve('packages/infrastructure/dist'), join(infra, 'dist'), { recursive: true });
    const resolution = join(release, 'node_modules/@proanima/arkvory-resolution');
    await mkdir(resolution, { recursive: true });
    await cp(resolve('packages/resolution/dist'), join(resolution, 'dist'), { recursive: true });
    await cp(resolve('packages/resolution/package.json'), join(resolution, 'package.json'));
    const rogue = join(root, 'node_modules/@proanima/arkvory-extension-api');
    await mkdir(rogue, { recursive: true });
    await writeFile(join(rogue, 'package.json'), '{"type":"module","exports":"./index.js"}');
    const marker = join(root, 'rogue-executed');
    await writeFile(
      join(rogue, 'index.js'),
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe'); export const canonicalJson = () => ''; export const parseModuleManifest = () => null; export class ModuleServiceError extends Error {}`,
    );
    const worker = new Worker(join(infra, 'dist/module-compute-thread.js'), {
      workerData: { directory: root, entry: 'files/task.mjs', input: null },
      env: { ...process.env, NODE_PATH: join(root, 'node_modules'), NODE_OPTIONS: '' },
      execArgv: [],
    });
    t.after(() => worker.terminate());
    const failure = await new Promise((resolve) => worker.once('error', resolve));
    assert.match(failure.message, /confined/);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  },
);

test('compute refuses a declared entry whose directory link escapes the signed package', async (t) => {
  const inside = await fixture(t, 'export default () => null;');
  const outside = await fixture(t, 'export default () => 42;');
  await symlink(
    join(outside.root, 'files'),
    join(inside.root, 'files/link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const pool = new ModuleCompute(inside.root, [{ name: 'escape', entry: 'files/link/task.mjs' }]);
  t.after(() => pool.close());
  await assert.rejects(pool.run('escape', null, new AbortController().signal));
});

test('compute workers do not inherit NODE_PATH or NODE_OPTIONS injections', async (t) => {
  const { pool } = await fixture(
    t,
    'export default () => ({ path: process.env.NODE_PATH, options: process.env.NODE_OPTIONS });',
  );
  const priorPath = process.env.NODE_PATH;
  const priorOptions = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_PATH = join(tmpdir(), 'untrusted-compute-dependencies');
    process.env.NODE_OPTIONS = '--require=untrusted-compute-preload';
    assert.deepEqual(await pool.run('task', null, new AbortController().signal), {
      path: '',
      options: '',
    });
  } finally {
    if (priorPath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = priorPath;
    if (priorOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = priorOptions;
  }
});

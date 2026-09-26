import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresCatalog } from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';

const listeners = () => ({
  drain: process.stdout.listenerCount('drain'),
  error: process.stdout.listenerCount('error'),
});

test('assembly failure after ownership acquisition releases the database and diagnostic listeners', async (t) => {
  const f = await setup(t);
  await f.app.close();
  const before = listeners();
  // Invalid CORS is encountered after resources have been initialized, during HTTP wiring.
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      createServer({ ...f.config, corsOrigins: ['https://invalid.example/path'] }),
      /CORS origins require HTTPS or loopback HTTP/,
    );
    assert.deepEqual(listeners(), before);
  }
  await f.restart();
  const response = await f.app.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().writable, true);
});

test('partial startup and repeated close leave ownership reusable without stranding listeners', async (t) => {
  const f = await setup(t);
  await f.app.close();
  const before = listeners();
  const original = PostgresCatalog.prototype.claimStorage;
  PostgresCatalog.prototype.claimStorage = async function (...args) {
    await original.apply(this, args);
    throw new Error('Controlled failure after ownership acquisition');
  };
  try {
    await assert.rejects(createServer(f.config), /Controlled failure after ownership acquisition/);
  } finally {
    PostgresCatalog.prototype.claimStorage = original;
  }
  assert.deepEqual(listeners(), before);
  await f.restart();
  await Promise.all([f.app.close(), f.app.close()]);
  assert.deepEqual(listeners(), before);
  await f.restart();
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
});

test('console directory belongs to explicit server configuration and does not read ambient env', async (t) => {
  const f = await setup(t);
  const directory = join(f.directory, 'console-fixture');
  await mkdir(directory);
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><title>Configured console</title>',
  );
  const previous = process.env.ARKVORY_WEB_DIR;
  process.env.ARKVORY_WEB_DIR = join(f.directory, 'absent-console');
  t.after(() => {
    if (previous === undefined) delete process.env.ARKVORY_WEB_DIR;
    else process.env.ARKVORY_WEB_DIR = previous;
  });
  f.config.webDirectory = directory;
  await f.restart();
  const response = await f.app.inject('/console/');
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /Configured console/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

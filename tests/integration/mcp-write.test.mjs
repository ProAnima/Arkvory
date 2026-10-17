import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ZipFile } from 'yazl';
import { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';

function observe(t) {
  const records = [];
  const original = DiagnosticLogger.prototype.write;
  DiagnosticLogger.prototype.write = function (record) {
    records.push(record);
    return original.call(this, record);
  };
  t.after(() => {
    DiagnosticLogger.prototype.write = original;
  });
  return records;
}

/** The real `arkvoryctl mcp --write …` as the child process an agent client starts. */
function start(t, env, args) {
  const child = spawn(process.execPath, [resolve('apps/cli/dist/main.js'), 'mcp', ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '',
    buffer = '';
  const waiting = new Map();
  child.stderr.on('data', (chunk) => (output += chunk));
  child.stdout.on('data', (chunk) => {
    output += chunk;
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  const exited = new Promise((done) => child.once('exit', (code) => done(code)));
  t.after(() => child.kill());
  let next = 1;
  const request = (method, params) => {
    const id = next++;
    const answer = new Promise((done) => waiting.set(id, done));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return answer;
  };
  return {
    request,
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    call: async (name, args) => (await request('tools/call', { name, arguments: args })).result,
    close: () => (child.stdin.end(), exited),
    output: () => output,
  };
}

async function upack(version) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({ name: 'mcp-app', version })), 'upack.json');
  zip.addBuffer(Buffer.from('build ' + version), 'package/build.txt');
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('arkvoryctl mcp --write: publish, verify, promote, annotate; refusals are coded', async (t) => {
  const records = observe(t);
  const f = await setup(t, { accessLog: true });
  const server = (await f.listen()) + '/';
  const token = f.headers.authorization.slice(7);
  const tokenFile = join(f.directory, 'key');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const root = join(f.directory, 'work');
  await mkdir(join(root, 'out'), { recursive: true });
  // Larger than one 8 MiB part: the parts are slices read through the same file handle.
  const bytes = randomBytes(9 * 1024 * 1024 + 7);
  await writeFile(join(root, 'build.bin'), bytes);
  await writeFile(join(root, 'app.upack'), await upack('1.2.3'));
  const home = join(f.directory, 'cli');
  const env = { ...process.env, ARKVORY_CLI_HOME: home };
  delete env.ARKVORY_TOKEN;
  Object.assign(env, { ARKVORY_BASE_URL: server, ARKVORY_TOKEN_FILE: tokenFile });
  const mcp = start(t, env, [
    '--root',
    root,
    '--write',
    '--write-repositories',
    'releases,elsewhere',
  ]);
  const hello = await mcp.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  assert.match(hello.result.instructions, /Writes are limited to: releases, elsewhere/);
  mcp.notify('notifications/initialized');
  const tools = (await mcp.request('tools/list', {})).result.tools.map((tool) => tool.name);
  for (const name of ['arkvory_upload', 'arkvory_publish_package', 'arkvory_promote'])
    assert.ok(tools.includes(name), tools.join());

  // Publish, then the same call again: the checkpoint returns the same artifact.
  const input = { file: 'build.bin', labels: ['test'], metadata: { commit: 'abc123' } };
  const uploaded = await mcp.call('arkvory_upload', input);
  assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
  const receipt = uploaded.structuredContent;
  assert.equal(receipt.sha256, sha256(bytes));
  assert.equal(receipt.artifact.status, 'available');
  assert.equal(receipt.artifact.descriptor.sha256, sha256(bytes));
  const id = receipt.artifact.id;
  assert.equal((await mcp.call('arkvory_upload', input)).structuredContent.artifact.id, id);
  assert.deepEqual(await readdir(root), ['app.upack', 'build.bin', 'out'], 'nothing beside');
  assert.equal((await readdir(join(home, 'mcp-uploads'))).length, 1);

  // Download it back with verification.
  const downloaded = await mcp.call('arkvory_download', { id, path: 'out/copy.bin' });
  assert.equal(downloaded.structuredContent.sha256, sha256(bytes));
  assert.deepEqual(await readFile(join(root, 'out', 'copy.bin')), bytes);

  // By path: the next revision, then the same bytes upload nothing.
  const path = { file: 'build.bin', repositoryPath: 'builds/mcp/build.bin' };
  const placed = (await mcp.call('arkvory_upload', path)).structuredContent;
  assert.deepEqual([placed.created, placed.revision], [true, 1]);
  assert.equal((await mcp.call('arkvory_upload', path)).structuredContent.created, false);

  const published = await mcp.call('arkvory_publish_package', { file: 'app.upack' });
  assert.equal(published.isError, undefined, JSON.stringify(published));
  assert.equal(published.structuredContent.package.version, '1.2.3');

  // Promote only the verified bytes; annotate at the read revision.
  const wrong = await mcp.call('arkvory_promote', { id, stage: 'staging', sha256: 'f'.repeat(64) });
  assert.equal(wrong.structuredContent.error.code, 'integrity_mismatch');
  const promoted = await mcp.call('arkvory_promote', {
    id,
    stage: 'staging',
    sha256: sha256(bytes),
  });
  assert.equal(promoted.isError, undefined, JSON.stringify(promoted));
  const read = (await mcp.call('arkvory_artifact', { id })).structuredContent;
  assert.deepEqual(
    read.stages.map((stage) => stage.stage),
    ['staging'],
  );
  const revision = read.annotations.revision;
  const annotate = { id, expectedRevision: revision, labels: ['qa', 'test'] };
  const annotated = await mcp.call('arkvory_annotate', annotate);
  assert.equal(annotated.isError, undefined, JSON.stringify(annotated));
  assert.deepEqual(annotated.structuredContent.annotations.labels, ['qa', 'test']);
  assert.deepEqual(annotated.structuredContent.annotations.metadata, { commit: 'abc123' });
  const stale = await mcp.call('arkvory_annotate', annotate);
  assert.equal(stale.structuredContent.error.code, 'conflict');
  const removed = await mcp.call('arkvory_stage_remove', { id, stage: 'staging' });
  assert.equal(removed.structuredContent.removed, 'staging');

  // Outside --write-repositories: refused before any request reaches the server.
  const before = records.filter((r) => r.code === 'http.access').length;
  const outside = await mcp.call('arkvory_upload', { repository: 'other', file: 'build.bin' });
  assert.equal(outside.structuredContent.error.code, 'repository_not_allowed');
  await new Promise((done) => setTimeout(done, 200));
  assert.equal(records.filter((r) => r.code === 'http.access').length, before);
  // Listed, but the key may not write there: the server's 403 comes back coded.
  const denied = await mcp.call('arkvory_upload', { repository: 'elsewhere', file: 'build.bin' });
  assert.equal(denied.structuredContent.error.code, 'forbidden');
  assert.ok(denied.structuredContent.error.requestId);
  const escape = await mcp.call('arkvory_upload', { file: '../key' });
  assert.equal(escape.structuredContent.error.code, 'path_outside_root');

  assert.equal(await mcp.close(), 0);
  assert.equal(mcp.output().includes(token), false, 'the key never reaches stdout or stderr');

  // A root that holds the CLI home and the key file: neither is ever replaced or sent.
  const wide = start(t, env, ['--root', f.directory, '--write']);
  await wide.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  wide.notify('notifications/initialized');
  const replaced = await wide.call('arkvory_download', {
    id,
    path: 'cli/mcp-uploads/x.json',
    overwrite: true,
  });
  assert.equal(replaced.structuredContent.error.code, 'private_path');
  const sent = await wide.call('arkvory_upload', { file: 'key' });
  assert.equal(sent.structuredContent.error.code, 'private_path');
  assert.equal(await wide.close(), 0);
  assert.equal(wide.output().includes(token), false);
});

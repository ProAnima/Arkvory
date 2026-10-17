import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import { setup, descriptor, base } from './fixture.mjs';

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

/** The real `arkvoryctl mcp` as the child process an agent client starts. */
function start(t, env, root) {
  const child = spawn(process.execPath, [resolve('apps/cli/dist/main.js'), 'mcp', '--root', root], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '',
    stderr = '',
    buffer = '';
  const waiting = new Map();
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
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
  return {
    request(method, params) {
      const id = next++;
      const answer = new Promise((done) => waiting.set(id, done));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return answer;
    },
    notify(method) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    },
    async close() {
      child.stdin.end();
      return exited;
    },
    output: () => stdout + stderr,
  };
}

test('arkvoryctl mcp: search, verified download, coded refusal, no key on any stream', async (t) => {
  const records = observe(t);
  const f = await setup(t, { accessLog: true });
  const server = (await f.listen()) + '/';
  const token = f.headers.authorization.slice(7);
  const tokenFile = join(f.directory, 'key');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const root = join(f.directory, 'work');
  await mkdir(join(root, 'out'), { recursive: true });
  const bytes = Buffer.from('mcp artifact ' + randomUUID());
  const created = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: { ...descriptor(bytes), name: 'mcp-build.bin' },
  });
  const id = created.json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);

  const env = { ...process.env, ARKVORY_CLI_HOME: join(f.directory, 'cli') };
  delete env.ARKVORY_TOKEN;
  Object.assign(env, { ARKVORY_BASE_URL: server, ARKVORY_TOKEN_FILE: tokenFile });
  const mcp = start(t, env, root);
  const hello = await mcp.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  assert.equal(hello.result.protocolVersion, '2025-11-25');
  mcp.notify('notifications/initialized');
  const tools = (await mcp.request('tools/list', {})).result.tools.map((tool) => tool.name);
  assert.ok(tools.includes('arkvory_download') && tools.includes('arkvory_search'), tools.join());

  const call = async (name, args) =>
    (await mcp.request('tools/call', { name, arguments: args })).result;
  const found = await call('arkvory_search', { query: 'MCP-BUILD' });
  assert.deepEqual(
    found.structuredContent.items.map((item) => [item.id, item.repository]),
    [[id, 'releases']],
  );
  const downloaded = await call('arkvory_download', { id, path: 'out/a.bin' });
  assert.equal(downloaded.isError, undefined, JSON.stringify(downloaded));
  assert.equal(downloaded.structuredContent.path, 'out/a.bin');
  const written = await readFile(join(root, 'out', 'a.bin'));
  assert.equal(
    createHash('sha256').update(written).digest('hex'),
    downloaded.structuredContent.sha256,
  );
  const again = await call('arkvory_download', { id, path: 'out/a.bin' });
  assert.equal(again.structuredContent.error.code, 'destination_exists');
  const outside = await call('arkvory_download', { id, path: '../escape.bin' });
  assert.equal(outside.structuredContent.error.code, 'path_outside_root');
  const refused = await call('arkvory_artifacts', { repository: 'elsewhere' });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.error.code, 'forbidden');
  assert.equal(refused.structuredContent.error.reason, 'permission_missing');
  assert.ok(refused.structuredContent.error.requestId);
  const status = await call('arkvory_status', {});
  assert.equal(status.structuredContent.server.state, 'ok');

  assert.equal(await mcp.close(), 0, 'the server exits when the client closes stdin');
  // The same search from the command line (`search --all`, ADR 0081 stage M4).
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve('apps/cli/dist/main.js'),
      'search',
      '--all',
      '--query',
      'mcp-build',
      '--limit',
      '5',
      '--json',
    ],
    { env, windowsHide: true, timeout: 30000 },
  );
  assert.deepEqual(
    JSON.parse(stdout).items.map((item) => item.id),
    [id],
  );
  assert.equal(mcp.output().includes(token), false, 'the key never reaches stdout or stderr');
  for (let i = 0; i < 100 && !records.some((r) => r.client); i++)
    await new Promise((done) => setTimeout(done, 10));
  const access = records.filter((r) => r.code === 'http.access' && r.client);
  assert.ok(access.length > 0);
  assert.ok(
    access.every((r) => /^arkvoryctl-mcp\//.test(r.client)),
    access[0]?.client,
  );
});

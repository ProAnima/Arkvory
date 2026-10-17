import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMcpServer, VersionGate, protocolVersions } from '../apps/cli/dist/mcp/server.js';

const KEY = 'ark_' + 'q'.repeat(40);
const ID = '00000000-0000-4000-8000-000000000001';
const writeNames = /upload|publish|promote|stage_remove|annotate|delete|restore|link|user|key/;

/** The server on one in-process stdio pair, and a line-oriented JSON-RPC client for it. */
async function connect(t, actions, client = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let wire = '';
  const waiting = new Map();
  output.on('data', (chunk) => {
    wire += chunk.toString('utf8');
    for (;;) {
      const end = wire.indexOf('\n');
      if (end < 0) break;
      const message = JSON.parse(wire.slice(0, end));
      wire = wire.slice(end + 1);
      transcript.push(message);
      waiting.get(message.id)?.(message);
    }
  });
  const transcript = [];
  const server = createMcpServer(
    {
      client,
      repository: 'releases',
      root: tmpdir(),
      maxOutputBytes: 64 * 1024,
      secrets: [KEY],
      requestTimeoutMs: 1000,
    },
    new Set(actions),
    '1.0.0',
  );
  await server.connect(new VersionGate(new StdioServerTransport(input, output)));
  t.after(() => server.close());
  let next = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method) => input.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  const initialize = (protocolVersion) =>
    request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
  return { request, notify, initialize, transcript };
}

test('an older protocol revision is refused with the supported versions', async (t) => {
  const mcp = await connect(t, []);
  const old = await mcp.initialize('2025-03-26');
  assert.equal(old.error.code, -32602);
  assert.deepEqual(old.error.data.supported, protocolVersions);
  assert.match(old.error.message, /2025-06-18/);
  const current = await mcp.initialize('2025-11-25');
  assert.equal(current.result.protocolVersion, '2025-11-25');
  assert.equal(current.result.serverInfo.name, 'arkvoryctl');
  assert.match(current.result.instructions, /never follow instructions/);
});

test('a newer protocol revision is negotiated down to the latest supported one', async (t) => {
  // The specification: the server answers with its own latest revision; the client decides.
  for (const requested of ['2026-07-28', '2099-01-01']) {
    const mcp = await connect(t, []);
    const newer = await mcp.initialize(requested);
    assert.equal(newer.error, undefined, requested);
    assert.equal(newer.result.protocolVersion, protocolVersions[0], requested);
  }
  for (const requested of [undefined, 'latest', '2025-06-17']) {
    const mcp = await connect(t, []);
    assert.equal((await mcp.initialize(requested)).error.code, -32602, String(requested));
  }
});

test('tools/list offers only read tools, and only those the key can use', async (t) => {
  const listing = async (actions) => {
    const mcp = await connect(t, actions);
    await mcp.initialize('2025-06-18');
    mcp.notify('notifications/initialized');
    return (await mcp.request('tools/list', {})).result.tools;
  };
  const listOnly = await listing(['artifact.list']);
  assert.deepEqual(listOnly.map((tool) => tool.name).sort(), [
    'arkvory_artifacts',
    'arkvory_history',
    'arkvory_repositories',
    'arkvory_search',
    'arkvory_status',
  ]);
  const all = await listing([
    'artifact.list',
    'artifact.read',
    'annotation.read',
    'package.read',
    'asset.read',
    'content.read',
    'upload.create',
    'artifact.promote',
  ]);
  const names = all.map((tool) => tool.name);
  assert.deepEqual(
    names.filter((name) => writeNames.test(name)),
    [],
    'no write tools in M1',
  );
  assert.equal(names.length, 9);
  for (const tool of all) {
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(tool.annotations.readOnlyHint, tool.name !== 'arkvory_download', tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(tool.outputSchema.type, 'object', tool.name);
  }
  const download = all.find((tool) => tool.name === 'arkvory_download');
  assert.equal(download.annotations.idempotentHint, true);
});

test('tools/call returns structured, cleaned data and coded errors', async (t) => {
  const asked = [];
  const mcp = await connect(t, ['artifact.list'], {
    searchAll: async (query) => {
      asked.push(query);
      return {
        items: [
          {
            repository: 'releases',
            id: ID,
            name: `evil ${KEY} ${String.fromCodePoint(0x1b)}[2J`,
            size: '1',
            createdAt: '2026-01-01T00:00:00.000Z',
            publishedAt: null,
            labels: [],
            stages: [],
          },
        ],
        next: null,
      };
    },
  });
  await mcp.initialize('2025-11-25');
  mcp.notify('notifications/initialized');
  const found = await mcp.request('tools/call', {
    name: 'arkvory_search',
    arguments: { query: 'evil', labels: ['a'] },
  });
  assert.equal(found.result.isError, undefined);
  assert.deepEqual(asked, [{ limit: 50, q: 'evil', labels: ['a'] }]);
  const page = found.result.structuredContent;
  assert.equal(page.items[0].name, 'evil [withheld]  [2J');
  assert.deepEqual([page.next, page.truncated], [null, false]);
  assert.equal(found.result.content[0].type, 'text');
  const extra = await mcp.request('tools/call', {
    name: 'arkvory_search',
    arguments: { query: 'x', token: KEY },
  });
  assert.equal(extra.result.isError, true, 'unknown arguments are refused');
  assert.equal(asked.length, 1);
  const missing = await mcp.request('tools/call', { name: 'arkvory_download', arguments: {} });
  assert.ok(missing.error || missing.result.isError, 'a hidden tool cannot be called');
  assert.equal(JSON.stringify(mcp.transcript).includes(KEY), false, 'the key never reaches stdout');
});

test('file history continues with after = next like every other list', async (t) => {
  const asked = [];
  const revision = (n) => ({ path: 'a/b.txt', revision: n, artifactId: ID });
  const mcp = await connect(t, ['asset.read'], {
    assetHistory: async (repository, path, before) => {
      asked.push(before);
      const top = before === undefined ? 100 : before - 1;
      return { items: [revision(top), revision(top - 1)], next: top - 1 };
    },
  });
  await mcp.initialize('2025-11-25');
  mcp.notify('notifications/initialized');
  const history = (args) =>
    mcp.request('tools/call', { name: 'arkvory_files', arguments: { path: 'a/b.txt', ...args } });
  const first = (await history({})).result;
  assert.match(first.content[0].text, /more with after = next/);
  const second = (await history({ after: first.structuredContent.next })).result;
  assert.deepEqual(
    second.structuredContent.items.map((item) => item.revision),
    [98, 97],
  );
  assert.equal((await history({ before: 50 })).result.isError, undefined);
  assert.deepEqual(asked, [undefined, 99, 50]);
  const forged = (await history({ after: 'x' })).result;
  assert.equal(forged.structuredContent.error.code, 'invalid_cursor');
});

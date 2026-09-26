import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import { ArkvoryClient, ArkvoryNetworkError, ArkvoryHttpError } from '@proanima/arkvory-sdk';

test('SDK public declarations preserve the strict consumer contract from 81703c5', () => {
  const config = ts.readConfigFile(resolve('tsconfig.base.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    {
      ...config.config,
      compilerOptions: {
        ...config.config.compilerOptions,
        customConditions: [],
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      },
    },
    ts.sys,
    process.cwd(),
  );
  assert.deepEqual(parsed.errors, []);
  const program = ts.createProgram([resolve('tests/fixtures/sdk-consumer.ts')], parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  );
});

async function serve(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('shared HTTP transport preserves deployment prefix, path encoding and fresh credentials', async (t) => {
  const requests = [];
  const url = await serve(t, (req, res) => {
    requests.push([req.method, req.url, req.headers.authorization]);
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'forbidden', requestId: 'test-request' }));
  });
  for (const suffix of ['/arkvory', '/arkvory/']) {
    let token = 'first-test-credential';
    const client = new ArkvoryClient(url + suffix, () => token);
    const scoped = client.inRepository('releases');
    const expectForbidden = (error) => error instanceof ArkvoryHttpError && error.status === 403;
    await assert.rejects(scoped.artifacts.get('group/id?x'), expectForbidden);
    token = 'next-test-credential';
    await assert.rejects(client.administration.users.list(), expectForbidden);
    await assert.rejects(client.identity.me(), expectForbidden);
  }
  assert.deepEqual(
    requests,
    Array.from({ length: 2 }, () => [
      [
        'GET',
        '/arkvory/api/v1/repositories/releases/artifacts/group%2Fid%3Fx',
        'Bearer first-test-credential',
      ],
      ['GET', '/arkvory/api/v1/users', 'Bearer next-test-credential'],
      ['GET', '/arkvory/api/v1/auth/me', 'Bearer next-test-credential'],
    ]).flat(),
  );
});

test('redirects never forward credentials and proxy errors remain sanitized', async (t) => {
  let destinationCalls = 0;
  const destination = await serve(t, (_req, res) => {
    destinationCalls++;
    res.end('unexpected');
  });
  let redirect = true;
  const source = await serve(t, (_req, res) => {
    if (redirect) {
      res.writeHead(302, { location: destination });
      res.end();
    } else {
      res.writeHead(502);
      res.end('<html>private proxy diagnostics</html>');
    }
  });
  const client = new ArkvoryClient(source, () => 'test-credential');
  await assert.rejects(client.repositories(), ArkvoryNetworkError);
  assert.equal(destinationCalls, 0);
  redirect = false;
  await assert.rejects(client.repositories(), (error) => {
    assert(error instanceof ArkvoryHttpError);
    assert.equal(error.status, 502);
    assert.equal(error.code, 'http_error');
    assert(!String(error).includes('private proxy'));
    return true;
  });
});

test('transfer workflows retain public override hooks after composition', async () => {
  const bytes = Buffer.from('saved part');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const upload = {
    id: 'test-id',
    repository: 'releases',
    status: 'pending',
    createdAt: '',
    expiresAt: '',
    descriptor: { name: 'test', size: String(bytes.length), sha256, labels: [], metadata: {} },
  };
  const calls = [];
  class CustomizedClient extends ArkvoryClient {
    async status(repository, id) {
      calls.push(['status', repository, id]);
      return upload;
    }
    async parts(repository, id) {
      calls.push(['parts', repository, id]);
      return { partBytes: 8 * 1024 ** 2, items: [{ index: 0, size: bytes.length, sha256 }] };
    }
    async complete(repository, id) {
      calls.push(['complete', repository, id]);
      return { ...upload, status: 'available' };
    }
    async artifact(repository, id) {
      calls.push(['artifact', repository, id]);
      return { ...upload, status: 'available' };
    }
  }
  // Every byte already exists: upload and verified prefix need no HTTP request.
  const client = new CustomizedClient('https://unused.invalid', () => {
    throw new Error('Unexpected HTTP');
  });
  const scoped = client.inRepository('releases');
  assert.equal((await scoped.uploads.resume(upload.id, new Blob([bytes]))).status, 'available');
  const stream = await client.downloadVerified('releases', upload.id, {
    prefix: new Blob([bytes]),
  });
  assert.equal((await new Response(stream).arrayBuffer()).byteLength, 0);
  assert.deepEqual(
    calls,
    ['status', 'parts', 'complete', 'artifact'].map((name) => [name, 'releases', upload.id]),
  );
});

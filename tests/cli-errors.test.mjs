// arkvoryctl failure reporting (ADR 0051, docs/CLI.md): exit codes, JSON and one-line text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';
import { errorCodes, errorReasons } from '@proanima/arkvory-contracts';
import {
  CliError,
  PublicationError,
  failure,
  failureText,
  sanitize,
} from '../apps/cli/dist/errors.js';
import { explain } from '../apps/cli/dist/explanations.js';
import { verboseLine } from '../apps/cli/dist/profiles.js';
import { parseArguments } from '../apps/cli/dist/arguments.js';

const http = (status, code, extra = {}, requestId = 'req-1', retryAfterMs = undefined) =>
  new ArkvoryHttpError(status, code, requestId, retryAfterMs, extra);

test('exit codes follow the server code first and the HTTP status for proxies', () => {
  const cases = [
    [http(401, 'unauthorized', { reason: 'session_expired' }), 3],
    [http(403, 'forbidden', { reason: 'read_only_token' }), 3],
    [http(409, 'conflict', { reason: 'upload_expired' }), 6],
    [http(422, 'integrity_mismatch'), 5],
    [http(507, 'capacity_exceeded', { reason: 'storage_quota' }), 8],
    [http(429, 'rate_limited', { reason: 'login_attempts' }, 'r', 5000), 4],
    [http(503, 'busy', {}, 'r', 2000), 4],
    [http(500, 'internal'), 4],
    [http(404, 'not_found', { reason: 'route_not_found' }), 4],
    [http(507, 'http_error', {}, ''), 8],
    [http(422, 'http_error', {}, ''), 5],
    [http(502, 'http_error', {}, ''), 4],
  ];
  for (const [error, exit] of cases)
    assert.equal(failure(error, false).exitCode, exit, `${error.status} ${error.code}`);
  assert.equal(failure(new ArkvoryIntegrityError(), false).exitCode, 5);
  assert.equal(failure(new ArkvoryNetworkError(), false).exitCode, 4);
  assert.equal(failure(new CliError('state_locked', 6), false).exitCode, 6);
  assert.equal(failure(http(409, 'conflict'), true).exitCode, 130);
  for (const [code, exit] of [
    ['size_mismatch', 6],
    ['file_changed', 6],
    ['invalid_response', 7],
    ['insecure_url', 2],
    ['completion_failed', 4],
  ])
    assert.equal(failure(new ArkvoryClientError(code, 'x'), false).exitCode, exit, code);
  assert.equal(
    failure(new ArkvoryClientError('completion_failed', 'x', 'integrity_mismatch'), false)
      .serverCode,
    'integrity_mismatch',
  );
});

test('JSON failures keep old fields and add server code, reason, details and retry', () => {
  const error = http(
    429,
    'rate_limited',
    {
      reason: 'login_attempts',
      serverMessage: 'Too many authentication attempts; retry later',
      details: [{ field: '/name', problem: 'invalid' }],
    },
    'request-429',
    7000,
  );
  assert.deepEqual(failure(error, false), {
    code: 'http_error',
    status: 429,
    exitCode: 4,
    serverCode: 'rate_limited',
    reason: 'login_attempts',
    message: 'Too many authentication attempts; retry later',
    requestId: 'request-429',
    details: [{ field: '/name', problem: 'invalid' }],
    retryAfterSeconds: 7,
  });
  // A proxy page without the envelope keeps the pre-ADR shape.
  assert.deepEqual(failure(http(502, 'http_error', {}, ''), false), {
    code: 'http_error',
    status: 502,
    exitCode: 4,
  });
  const published = failure(new PublicationError('artifact-1', http(409, 'conflict')), false);
  assert.deepEqual(
    [published.stage, published.artifactId, published.exitCode],
    ['register', 'artifact-1', 6],
  );
});

test('text output is one sanitized line with code, reason, message and request ID', () => {
  const hostile = http(
    507,
    'capacity_exceeded',
    {
      reason: 'storage_quota',
      serverMessage: 'Quota\u001b[31m exceeded\nINJECTED‮' + 'x'.repeat(400),
    },
    'id-\u0007507',
  );
  const line = failureText(failure(hostile, false), 'en');
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f‮]/);
  assert.match(
    line,
    /^Arkvory: http_error HTTP 507 capacity_exceeded\/storage_quota: Quota \[31m exceeded INJECTED x+…\./,
  );
  assert.match(line, /Request ID: id- 507$/);
  assert.match(line, /repository quota is used up/);
  assert.ok(line.length < 600);
  const retry = failureText(failure(http(503, 'busy', {}, 'r-1', 2000), false), 'ru');
  assert.match(retry, /Повторите через 2 с\..*ID запроса: r-1/);
  assert.equal(sanitize('a\tb\r\nc', 10), 'a b c');
  assert.equal(sanitize('x'.repeat(20), 10), 'x'.repeat(9) + '…');
});

test('every CLI and server failure code has an explanation in both languages', async () => {
  const fallback = explain({ code: 'never-used-code' }, 'en');
  const sources = (await readdir('apps/cli/src')).filter((file) => file.endsWith('.ts'));
  const codes = new Set(['interrupted', 'integrity_failed', 'network_failed', 'request_timeout']);
  for (const file of sources) {
    const text = await readFile(`apps/cli/src/${file}`, 'utf8');
    for (const match of text.matchAll(/CliError\('([a-z_]+)'/g)) codes.add(match[1]);
    for (const match of text.matchAll(/code: '([a-z_]+)'/g)) codes.add(match[1]);
  }
  for (const code of ['size_mismatch', 'file_changed', 'upload_cancelled', 'completion_failed'])
    codes.add(code);
  codes.add('missing_server');
  codes.add('invalid_timeout');
  for (const code of codes)
    for (const language of ['en', 'ru'])
      assert.notEqual(
        explain({ code }, language),
        explain({ code: 'never-used-code' }, language),
        code,
      );
  for (const serverCode of errorCodes) {
    const text = explain({ code: 'http_error', serverCode }, 'en');
    assert.notEqual(text, explain({ code: 'http_error' }, 'en'), serverCode);
    assert.notEqual(text, fallback, serverCode);
  }
  // Reasons without their own text fall back to the code's explanation, never to --help.
  for (const [serverCode, reasons] of Object.entries(errorReasons))
    for (const reason of reasons)
      assert.notEqual(
        explain({ code: 'http_error', serverCode, reason }, 'ru'),
        explain({ code: 'x' }, 'ru'),
      );
});

test('--verbose prints method, path, status, duration and request ID only', (t) => {
  assert.equal(parseArguments(['list', '--verbose']).options.get('verbose'), 'true');
  const lines = [];
  t.mock.method(process.stderr, 'write', (line) => {
    lines.push(line);
    return true;
  });
  verboseLine({
    method: 'GET',
    path: '/api/v1/auth/me',
    status: 401,
    durationMs: 12,
    requestId: 'r-9',
  });
  verboseLine({ method: 'PUT', path: '/api/v1/x\u001b[2J', durationMs: 3 });
  assert.deepEqual(lines, [
    'arkvoryctl: GET /api/v1/auth/me 401 12 ms request r-9\n',
    'arkvoryctl: PUT /api/v1/x [2J network-error 3 ms\n',
  ]);
});

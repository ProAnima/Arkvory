import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DiagnosticLogger, SCHEMA_VERSION } from '@proanima/arkvory-infrastructure';
import { setup, create, base } from './fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
const traceparent = `00-${trace}-00f067aa0ba902b7-01`;

/** Runs a service entry point against the fixture database; resolves after stdio closes. */
function child(f, args, env = {}) {
  return new Promise((resolve, reject) => {
    const running = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ARKVORY_DATABASE_URL: f.config.databaseUrl,
        ARKVORY_DATA_DIR: f.directory,
        ...env,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    running.stdout.on('data', (b) => (output += b));
    running.stderr.on('data', (b) => (output += b));
    running.on('error', reject);
    running.on('close', (code) => {
      const records = output
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));
      resolve({ code, output, records });
    });
  });
}

async function worker(f, env = {}) {
  const keys = join(f.directory, 'observability-keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  return child(f, ['apps/worker/dist/main.js', '--once'], { ARKVORY_KEYS_FILE: keys, ...env });
}

async function queuedJob(f, requestId) {
  const bytes = Buffer.from(`correlated ${randomUUID()}`);
  const id = (await create(f, bytes)).json().id;
  const part = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': sha(bytes),
    },
    payload: bytes,
  });
  assert.equal(part.statusCode, 204, part.body);
  const queued = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${id}/complete-async`,
    headers: { ...f.headers, 'x-request-id': requestId },
  });
  assert.equal(queued.statusCode, 202, queued.body);
  return { uploadId: id, job: queued.json(), responseId: queued.headers['x-request-id'] };
}

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

test('a trusted request ID is stored with the job and repeated on every worker line', async (t) => {
  const f = await setup(t, { trustedProxies: ['127.0.0.1'] });
  const requestId = 'obs-req-complete-0001';
  const { uploadId, job, responseId } = await queuedJob(f, requestId);
  assert.equal(responseId, requestId);
  assert.equal(job.requestId, undefined, 'job responses keep their published shape');
  const row = await f.catalog.pool.query('SELECT request_id FROM arkvory_jobs WHERE id=$1', [
    job.id,
  ]);
  assert.equal(row.rows[0].request_id, requestId);
  const result = await worker(f, { ARKVORY_LOG_LEVEL: 'debug' });
  assert.equal(result.code, 0, result.output);
  const started = result.records.find((r) => r.code === 'completion.started');
  const finished = result.records.find((r) => r.code === 'completion.completed');
  assert.ok(started && finished, result.output);
  for (const record of [started, finished]) {
    assert.equal(record.requestId, requestId);
    assert.equal(record.jobId, job.id);
    assert.equal(record.uploadId, uploadId);
    assert.equal(record.repository, 'releases');
    assert.equal(record.generation, 1);
    assert.equal(record.attempts, 1);
    assert.equal(record.service, 'worker');
  }
  assert.equal(started.level, 'debug');
  assert.equal(typeof finished.durationMs, 'number');
  assert.ok(result.records.some((r) => r.code === 'worker.started'));
  const quiet = await worker(f, { ARKVORY_LOG_LEVEL: 'warning' });
  assert.equal(quiet.code, 0, quiet.output);
  assert.equal(quiet.records.length, 0, 'info and debug lines are filtered');
  const invalid = await worker(f, { ARKVORY_LOG_LEVEL: 'verbose' });
  assert.equal(invalid.code, 1);
  assert.equal(
    invalid.records.find((r) => r.code === 'worker.unavailable')?.reason,
    'Invalid ARKVORY_LOG_LEVEL',
  );
});

test('an untrusted peer cannot choose the request ID; the generated one is propagated', async (t) => {
  const f = await setup(t);
  const { job, responseId } = await queuedJob(f, 'forged-request-0001');
  assert.notEqual(responseId, 'forged-request-0001');
  assert.match(responseId, /^[0-9a-f-]{36}$/);
  const row = await f.catalog.pool.query('SELECT request_id FROM arkvory_jobs WHERE id=$1', [
    job.id,
  ]);
  assert.equal(row.rows[0].request_id, responseId);
});

test('abandoned jobs with spent attempts are retired with one correlated error line', async (t) => {
  const f = await setup(t, { trustedProxies: ['127.0.0.1'] });
  const { job } = await queuedJob(f, 'obs-req-exhausted-01');
  await f.catalog.pool.query(
    "UPDATE arkvory_jobs SET status='running',attempts=5,lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  const result = await worker(f);
  assert.equal(result.code, 0, result.output);
  const exhausted = result.records.filter((r) => r.code === 'completion.attempts_exhausted');
  assert.equal(exhausted.length, 1, result.output);
  assert.equal(exhausted[0].level, 'error');
  assert.equal(exhausted[0].jobId, job.id);
  assert.equal(exhausted[0].requestId, 'obs-req-exhausted-01');
  const row = await f.catalog.pool.query('SELECT status,error_code FROM arkvory_jobs WHERE id=$1', [
    job.id,
  ]);
  assert.deepEqual(row.rows[0], { status: 'failed', error_code: 'attempts_exhausted' });
  const again = await worker(f);
  assert.equal(
    again.records.filter((r) => r.code === 'completion.attempts_exhausted').length,
    0,
    'a retired job is reported once',
  );
});

test('catalog and security audit rows keep the request ID without changing audit listings', async (t) => {
  const f = await setup(t, { trustedProxies: ['127.0.0.1'] });
  const bytes = Buffer.from('audited artifact');
  const id = (await create(f, bytes)).json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  const annotate = await f.app.inject({
    method: 'PUT',
    url: `${base}/artifacts/${id}/annotations`,
    headers: { ...f.headers, 'x-request-id': 'obs-req-annotate-01' },
    payload: { expectedRevision: 0, value: { labels: ['stable'], metadata: {}, collections: [] } },
  });
  assert.equal(annotate.statusCode, 200, annotate.body);
  const catalogRow = await f.catalog.pool.query(
    "SELECT request_id FROM arkvory_audit WHERE artifact_id=$1 AND action='annotations.replace'",
    [id],
  );
  assert.equal(catalogRow.rows[0].request_id, 'obs-req-annotate-01');
  const user = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { ...f.headers, 'x-request-id': 'obs-req-user-0001' },
    payload: { name: 'correlated', password: 'correlated-password-1', administrator: false },
  });
  assert.equal(user.statusCode, 201, user.body);
  const login = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'x-request-id': 'obs-req-login-0001' },
    payload: { name: 'correlated', password: 'wrong-password-123' },
  });
  assert.equal(login.statusCode, 401);
  const security = await f.catalog.pool.query(
    'SELECT action,outcome,request_id FROM arkvory_security_audit ORDER BY id',
  );
  assert.deepEqual(
    security.rows.map((r) => [r.action, r.outcome, r.request_id]),
    [
      ['user.create', 'success', 'obs-req-user-0001'],
      ['auth.login', 'failure', 'obs-req-login-0001'],
    ],
  );
  const listing = await f.app.inject({ url: '/api/v1/security/audit', headers: f.headers });
  assert.equal(listing.statusCode, 200, listing.body);
  assert.ok(listing.json().items.every((entry) => !('requestId' in entry)));
  const journal = await f.app.inject({ url: `${base}/audit?after=0`, headers: f.headers });
  assert.equal(journal.statusCode, 200, journal.body);
  assert.ok(journal.json().items.every((entry) => !('requestId' in entry)));
});

test('access log carries a valid traceparent trace ID and drops an invalid one', async (t) => {
  const records = observe(t);
  const f = await setup(t, { accessLog: true });
  const valid = await f.app.inject({
    url: '/health/ready',
    headers: { ...f.headers, traceparent },
  });
  const invalid = await f.app.inject({
    url: '/health/ready',
    headers: { ...f.headers, traceparent: traceparent.toUpperCase() },
  });
  assert.equal(valid.headers.traceparent, undefined, 'trace context is never echoed');
  const access = (requestId) =>
    records.find((r) => r.code === 'http.access' && r.requestId === requestId);
  for (
    let i = 0;
    i < 100 && (!access(valid.headers['x-request-id']) || !access(invalid.headers['x-request-id']));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(access(valid.headers['x-request-id'])?.traceId, trace);
  const rejected = access(invalid.headers['x-request-id']);
  assert.ok(rejected);
  assert.equal('traceId' in rejected, false);
  assert.equal(rejected.component, 'http');
});

test('metrics require a valid credential like readiness and expose bounded labels only', async (t) => {
  const f = await setup(t);
  const anonymous = await f.app.inject({ url: '/health/metrics' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers['www-authenticate'], 'Bearer');
  assert.equal(anonymous.json().code, 'unauthorized');
  const forged = await f.app.inject({
    url: '/health/metrics',
    headers: { authorization: `Bearer ${'x'.repeat(48)}` },
  });
  assert.equal(forged.statusCode, 401);
  const head = await f.app.inject({ method: 'HEAD', url: '/health/metrics' });
  assert.equal(head.statusCode, 401);
  const { uploadId } = await queuedJob(f, 'ignored-request-0001');
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  // Responses are counted on 'close', which may trail the injected response by a tick.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Read-only credentials are enough, as for /health/ready; no repository grant is required.
  const response = await f.app.inject({ url: '/health/metrics', headers: f.readerHeaders });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'text/plain; version=0.0.4; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const text = response.body;
  assert.match(
    text,
    /arkvory_http_requests_total\{method="GET",route="\/health\/ready",status_class="2xx"\} 1\n/,
  );
  assert.match(
    text,
    /arkvory_http_requests_total\{method="GET",route="\/health\/metrics",status_class="4xx"\} 2\n/,
  );
  assert.match(
    text,
    /arkvory_http_requests_total\{method="POST",route="\/api\/v1\/repositories\/:repository\/uploads\/:id\/complete-async",status_class="2xx"\} 1\n/,
  );
  assert.match(text, /arkvory_completion_jobs\{state="queued"\} 1\n/);
  assert.match(text, /# TYPE arkvory_http_request_duration_seconds histogram\n/);
  assert.match(text, /arkvory_build_info\{service="api",version="dev"\} 1\n/);
  assert.doesNotMatch(text, new RegExp(`${uploadId}|releases"|test-writer|Bearer`));
  const metricsHead = await f.app.inject({
    method: 'HEAD',
    url: '/health/metrics',
    headers: f.headers,
  });
  assert.equal(metricsHead.statusCode, 200);
  assert.equal(metricsHead.body, '');
});

test('migrate reports the schema it found and reached as structured records', async (t) => {
  const f = await setup(t);
  const result = await child(f, ['apps/api/dist/migrate.js']);
  assert.equal(result.code, 0, result.output);
  const started = result.records.find((r) => r.code === 'migrate.started');
  const completed = result.records.find((r) => r.code === 'migrate.completed');
  assert.deepEqual([started?.fromSchema, started?.toSchema], [SCHEMA_VERSION, SCHEMA_VERSION]);
  assert.deepEqual([completed?.fromSchema, completed?.toSchema], [SCHEMA_VERSION, SCHEMA_VERSION]);
  assert.equal(completed.service, 'migrate');
  assert.equal(typeof completed.durationMs, 'number');
  assert.doesNotMatch(result.output, /postgresql:\/\//);
});

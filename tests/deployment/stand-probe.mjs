// Runs inside a stand node with the installation's own Node.js: no repository packages there, so
// only the public HTTP API through fetch. Usage: node stand-probe.mjs <command> '<json arguments>'.
// Prints one JSON line; a failed expectation exits non-zero. Secrets are printed only where a
// command exists to hand one to the stand (mirror-key), never in errors.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { gzipSync } from 'node:zlib';

const [command = '', raw = '{}'] = process.argv.slice(2);
const args = JSON.parse(raw);
if (args.ca)
  setDefaultCACertificates([...getCACertificates('default'), await readFile(args.ca, 'utf8')]);
const token =
  args.token ?? (await readFile('/opt/proanima-arkvory/config/bootstrap-token.txt', 'utf8')).trim();
const repository = '/api/v1/repositories/releases';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n');
async function call(path, init = {}, bearer = token) {
  return fetch(args.url + path, {
    ...init,
    headers: { authorization: `Bearer ${bearer}`, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
}
async function expect(response, status, what) {
  if (response.status !== status) {
    const body = (await response.text()).slice(0, 400);
    throw new Error(`${what}: ${String(response.status)} ${body}`);
  }
  return response;
}

async function publish() {
  const bytes = randomBytes(args.size);
  const descriptor = {
    name: args.name,
    size: String(bytes.length),
    sha256: sha256(bytes),
    labels: ['stand'],
    metadata: {},
  };
  const created = await expect(
    await call(`${repository}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(descriptor),
    }),
    201,
    'create upload',
  );
  const { id } = await created.json();
  await expect(
    await call(`${repository}/uploads/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    }),
    200,
    'upload content',
  );
  return { id, sha256: descriptor.sha256 };
}

/** A read-only service key for the mirror, as SECOND_SITE prescribes; returns its secret. */
async function mirrorKey() {
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: [
        'artifact.list',
        'artifact.read',
        'content.read',
        'annotation.read',
        'asset.read',
        'package.read',
      ],
    },
  ];
  const json = { 'content-type': 'application/json' };
  const account = await expect(
    await call('/api/v1/service-accounts', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'mirror-b', bindings }),
    }),
    201,
    'create service account',
  );
  const { id } = await account.json();
  const issued = await expect(
    await call(`/api/v1/service-accounts/${id}/keys`, {
      method: 'POST',
      headers: { ...json, 'idempotency-key': randomUUID() },
      body: JSON.stringify({ name: 'mirror-b', bindings }),
    }),
    201,
    'issue key',
  );
  const { secret } = await issued.json();
  await expect(
    await call('/api/v1/auth/activate-key', { method: 'POST' }, secret),
    204,
    'activate key',
  );
  return { secret };
}

/** One ustar entry (header with checksum, data padded to 512 bytes) for a probe tarball. */
function tarEntry(name, data) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

/** Raw files, Git LFS and npm on this installation's schema: each stores and serves bytes. */
async function protocols() {
  const bytes = randomBytes(64 * 1024);
  const oid = sha256(bytes);
  const binary = { 'content-type': 'application/octet-stream' };
  const raw = `${repository}/raw/tools/probe.bin`;
  await expect(
    await call(raw, {
      method: 'PUT',
      headers: { ...binary, 'x-checksum-sha256': oid },
      body: bytes,
    }),
    201,
    'raw put',
  );
  const got = await expect(await call(raw), 200, 'raw get');
  if (sha256(Buffer.from(await got.arrayBuffer())) !== oid) throw new Error('raw content differs');
  // git-lfs sends text assets as text/plain; the body is still bytes.
  const object = `/lfs/releases/objects/${oid}`;
  const text = { 'content-type': 'text/plain' };
  await expect(await call(object, { method: 'PUT', headers: text, body: bytes }), 200, 'lfs put');
  const batch = await expect(
    await call('/lfs/releases/objects/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.git-lfs+json' },
      body: JSON.stringify({ operation: 'download', objects: [{ oid, size: bytes.length }] }),
    }),
    200,
    'lfs batch',
  );
  if (!(await batch.json()).objects[0]?.actions?.download) throw new Error('lfs object missing');
  const name = 'com.proanima.probe';
  const manifest = Buffer.from(JSON.stringify({ name, version: '1.0.0', unity: '2022.3' }));
  const tarball = gzipSync(
    Buffer.concat([tarEntry('package/package.json', manifest), Buffer.alloc(1024)]),
  );
  const publish = {
    name,
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { name, version: '1.0.0' } },
    _attachments: { 'p.tgz': { data: tarball.toString('base64'), length: tarball.length } },
  };
  await expect(
    await call(`/npm/releases/${name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(publish),
    }),
    201,
    'npm publish',
  );
  const packument = await (
    await expect(await call(`/npm/releases/${name}`), 200, 'packument')
  ).json();
  const tarballUrl = new URL(packument.versions['1.0.0'].dist.tarball).pathname;
  const fetched = await expect(await call(tarballUrl), 200, 'npm tarball');
  if (sha256(Buffer.from(await fetched.arrayBuffer())) !== sha256(tarball))
    throw new Error('npm tarball differs');
  return { raw: true, lfs: true, npm: packument['dist-tags'].latest };
}

/** A one-layer image pushed like docker does it, by tag. */
async function image() {
  const blob = async (bytes, mediaType) => {
    const digest = `sha256:${sha256(bytes)}`;
    await expect(
      await call(`/v2/releases/${args.image}/blobs/uploads/?digest=${digest}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      }),
      201,
      'push blob',
    );
    return { mediaType, digest, size: bytes.length };
  };
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: await blob(Buffer.from('{"os":"linux"}'), 'application/vnd.oci.image.config.v1+json'),
      layers: [await blob(randomBytes(256 * 1024), 'application/vnd.oci.image.layer.v1.tar')],
    }),
  );
  await expect(
    await call(`/v2/releases/${args.image}/manifests/${args.tag}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/vnd.oci.image.manifest.v1+json' },
      body: manifest,
    }),
    201,
    'push manifest',
  );
  return { digest: `sha256:${sha256(manifest)}` };
}

async function ready() {
  const deadline = Date.now() + (args.seconds ?? 120) * 1000;
  for (;;) {
    try {
      if ((await call('/health/ready')).status === 200) return { ready: true };
    } catch {}
    if (Date.now() > deadline) throw new Error('The API did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** One backup command (capture or deep verification) followed until its job ends. */
async function backupJob(path) {
  const receipt = await expect(
    await call(path, { method: 'POST', headers: { 'idempotency-key': randomUUID() } }),
    202,
    `request ${path}`,
  );
  const { id } = await receipt.json();
  const deadline = Date.now() + (args.seconds ?? 300) * 1000;
  for (;;) {
    const jobs = await (await call('/api/v1/backup/jobs?limit=20')).json();
    const job = jobs.items.find((item) => item.id === id);
    if (job?.state === 'completed') return job;
    if (job?.state === 'failed') throw new Error(`Backup job failed: ${String(job.errorCode)}`);
    if (Date.now() > deadline) throw new Error(`Backup job ${id} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const commands = {
  ready,
  'backup-status': async () => (await call('/api/v1/backup/status')).json(),
  'backup-capture': async () => {
    const job = await backupJob('/api/v1/backup/runs');
    const points = await (await call('/api/v1/backup/points?limit=10')).json();
    const point = points.items.find((item) => item.id === job.pointId);
    return { pointId: job.pointId, blobs: point?.blobs ?? 0 };
  },
  'backup-verify': async () => {
    const job = await backupJob(`/api/v1/backup/points/${args.point}/verify`);
    return { state: job.state };
  },
  publish,
  image,
  protocols,
  'mirror-key': mirrorKey,
  status: async () => {
    const response = await call(`${repository}/mirror`);
    return { status: response.status, ...(response.ok ? await response.json() : {}) };
  },
  content: async () => {
    const response = await call(`${repository}/artifacts/${args.id}/content`);
    if (response.status !== 200) return { status: response.status };
    return { status: 200, sha256: sha256(Buffer.from(await response.arrayBuffer())) };
  },
  manifest: async () => {
    const response = await call(`/v2/releases/${args.image}/manifests/${args.reference}`);
    await response.body?.cancel();
    return { status: response.status, digest: response.headers.get('docker-content-digest') };
  },
  'can-write': async () => {
    const response = await call(`${repository}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        name: 'w',
        size: '1',
        sha256: 'a'.repeat(64),
        labels: [],
        metadata: {},
      }),
    });
    const body = response.ok ? {} : await response.json();
    return { status: response.status, reason: body.reason ?? null };
  },
};
const run = commands[command];
if (!run) throw new Error(`Unknown probe command ${command}`);
out(await run());

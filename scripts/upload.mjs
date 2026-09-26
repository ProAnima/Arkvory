import { openAsBlob, createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const file = process.argv[2];
const repository = process.argv[3] ?? 'releases';
const uploadId = process.argv[4];
if (!file) throw new Error('Usage: npm run upload -- <file> [repository] [uploadId to resume]');
const token =
  process.env.ARKVORY_TOKEN || (await readFile(process.env.ARKVORY_TOKEN_FILE, 'utf8')).trim();
const client = new ArkvoryClient(
  process.env.ARKVORY_BASE_URL ?? 'http://127.0.0.1:8080',
  () => token,
);
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
const blob = await openAsBlob(file);
const hash = createHash('sha256');
for await (const chunk of createReadStream(file, { signal: stop.signal })) hash.update(chunk);
const sha256 = hash.digest('hex');
const key = process.env.ARKVORY_IDEMPOTENCY_KEY ?? randomUUID();
if (!uploadId) console.log(`Idempotency key: ${key}`);
const upload = uploadId
  ? await client.status(repository, uploadId, stop.signal)
  : await client.create(
      repository,
      key,
      {
        name: basename(file),
        size: String(blob.size),
        sha256,
        labels: [],
        metadata: {},
      },
      stop.signal,
    );
if (upload.descriptor.sha256 !== sha256 || Number(upload.descriptor.size) !== blob.size)
  throw new Error('Selected file does not match the upload');
console.log(`Upload ID: ${upload.id}`);
await client.resume(repository, upload.id, blob, {
  signal: stop.signal,
  onRetry: ({ attempt, delayMs }) => console.log(`Retry ${attempt}, waiting ${delayMs} ms`),
});
console.log(`Published artifact: ${upload.id}`);

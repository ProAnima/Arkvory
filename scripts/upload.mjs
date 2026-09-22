import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
const file = process.argv[2];
const repository = process.argv[3] ?? 'releases';
if (!file) throw new Error('Usage: npm run upload -- <file> [repository]');
const token =
  process.env.DEPOT_TOKEN ?? (await readFile(process.env.DEPOT_TOKEN_FILE, 'utf8')).trim();
const base = process.env.DEPOT_BASE_URL ?? 'http://127.0.0.1:8080';
const prefix = `${base}/api/v1/repositories/${encodeURIComponent(repository)}`;
const headers = { authorization: `Bearer ${token}` };
const hash = createHash('sha256');
for await (const chunk of createReadStream(file)) hash.update(chunk);
const info = await stat(file);
const response = await fetch(prefix + '/uploads', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
  body: JSON.stringify({
    name: basename(file),
    size: String(info.size),
    sha256: hash.digest('hex'),
  }),
});
if (!response.ok)
  throw new Error(`Reservation failed (${response.status}): ${await response.text()}`);
const upload = await response.json();
console.log(`Upload ID: ${upload.id}`);
const sent = await fetch(`${prefix}/uploads/${upload.id}/content`, {
  method: 'PUT',
  headers: {
    ...headers,
    'content-type': 'application/octet-stream',
    'content-length': String(info.size),
  },
  body: createReadStream(file),
  duplex: 'half',
});
if (!sent.ok) throw new Error(`Upload failed (${sent.status}): ${await sent.text()}`);
console.log(`Published: ${prefix}/artifacts/${upload.id}/content`);

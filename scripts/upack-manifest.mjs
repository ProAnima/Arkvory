import { createReadStream } from 'node:fs';
import { writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseManifest } from '@proanima/arkvory-domain';

// Prepares root upack.json before packaging. Published archives are immutable.
const { values } = parseArgs({
  options: { input: { type: 'string' }, metadata: { type: 'string' }, output: { type: 'string' } },
  strict: true,
  allowPositionals: false,
});
async function readJson(path) {
  if ((await stat(path)).size > 65536) throw new Error('JSON input exceeds 64 KiB');
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
    size += chunk.length;
    if (size > 65536) throw new Error('JSON input exceeds 64 KiB');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('JSON object required');
  return value;
}
try {
  if (!values.input || !values.metadata || !values.output)
    throw new Error(
      'Usage: npm run upack:manifest -- --input manifest.json --metadata custom.json --output upack.json',
    );
  const manifest = await readJson(values.input),
    metadata = await readJson(values.metadata);
  if (Object.keys(metadata).some((key) => !/^_[A-Za-z0-9_.-]{1,63}$/.test(key)))
    throw new Error('Custom metadata keys must begin with _');
  const prepared = { ...manifest, ...metadata };
  parseManifest(prepared);
  const output = JSON.stringify(prepared, null, 2) + '\n';
  if (Buffer.byteLength(output) > 65536) throw new Error('Manifest exceeds 64 KiB');
  // Exclusive creation avoids accidental replacement of an original manifest.
  await writeFile(resolve(values.output), output, { flag: 'wx' });
  process.stdout.write(
    'Prepared UPack manifest. Include it as root upack.json when creating a new archive.\n',
  );
} catch (error) {
  // Only validation messages generated here; filesystem paths and supplied JSON stay out of logs.
  const safe =
    error instanceof Error &&
    (error.message.startsWith('Usage:') ||
      [
        'JSON input exceeds 64 KiB',
        'JSON object required',
        'Custom metadata keys must begin with _',
        'Manifest exceeds 64 KiB',
      ].includes(error.message))
      ? error.message
      : 'Manifest preparation failed; check paths and ensure output does not exist.';
  process.stderr.write(safe + '\n');
  process.exitCode = 1;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import yazl from 'yazl';
import { LocalBlobStore, ZipManifestReader } from '@proanima/arkvory-infrastructure';
import { randomUUID } from 'node:crypto';
import { removeTestDirectory } from './helpers.mjs';

test('prepared UPack manifest preserves nested custom metadata inside the immutable archive', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-upack-meta-'));
  t.after(() => removeTestDirectory(directory));
  const input = join(directory, 'input.json'),
    metadata = join(directory, 'custom.json'),
    output = join(directory, 'upack.json');
  await writeFile(
    input,
    JSON.stringify({ name: 'example', version: '1.2.3', description: 'Build' }),
  );
  const custom = {
    _build: { commit: 'abc', number: 42, targets: ['win', 'linux'] },
    _labels: ['test', 'staging'],
  };
  await writeFile(metadata, JSON.stringify(custom));
  const args = [
    'scripts/upack-manifest.mjs',
    '--input',
    input,
    '--metadata',
    metadata,
    '--output',
    output,
  ];
  await promisify(execFile)(process.execPath, args);
  const content = await readFile(output);
  assert.deepEqual(JSON.parse(content)._build, custom._build);
  await assert.rejects(promisify(execFile)(process.execPath, args));
  assert.deepEqual(await readFile(output), content);
  const blobs = new LocalBlobStore(join(directory, 'storage'));
  await blobs.initialize();
  const id = randomUUID(),
    zip = new yazl.ZipFile();
  zip.addBuffer(content, 'upack.json');
  zip.addBuffer(Buffer.from('payload'), 'package/file.bin');
  zip.addBuffer(Buffer.from('{"sbom":"example"}'), 'metadata/sbom.json');
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(blobs.contentPath(id)));
  const manifest = await new ZipManifestReader(blobs).inspect(id);
  assert.deepEqual(manifest.original._build, custom._build);
  assert.deepEqual(manifest.original._labels, custom._labels);
  assert.equal(manifest.name, 'example');
  await writeFile(metadata, JSON.stringify({ name: 'replace-standard-field' }));
  await assert.rejects(
    promisify(execFile)(process.execPath, [...args.slice(0, -1), join(directory, 'rejected.json')]),
  );
});

test('UPack manifest decoding rejects invalid UTF-8 instead of changing metadata bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-upack-utf8-'));
  t.after(() => removeTestDirectory(directory));
  const blobs = new LocalBlobStore(join(directory, 'storage'));
  await blobs.initialize();
  const id = randomUUID();
  const zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.concat([
      Buffer.from('{"name":"x","version":"1.0.0","_custom":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]),
    'upack.json',
  );
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(blobs.contentPath(id)));
  await assert.rejects(new ZipManifestReader(blobs).inspect(id), { code: 'invalid_input' });
});

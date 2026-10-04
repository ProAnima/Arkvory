import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { GzipNpmTarballInspector, NpmPublishBody } from '@proanima/arkvory-infrastructure';
import { tar, tarEntry as entry } from './npm-fixtures.mjs';
import {
  npmIntegrityMatches,
  npmPackument,
  parseNpmDetail,
  parseNpmPublish,
} from '@proanima/arkvory-domain';

const manifest = (fields = {}) =>
  Buffer.from(JSON.stringify({ name: 'com.example.tools', version: '1.2.0', ...fields }));
const pax = (path) => {
  const record = (length) => `${length} path=${path}\n`;
  let length = record(0).length;
  while (record(length).length !== length) length = record(length).length;
  return Buffer.from(record(length));
};
async function* chunks(bytes, size) {
  for (let offset = 0; offset < bytes.length; offset += size)
    yield bytes.subarray(offset, offset + size);
}
const inspect = (bytes, size = 4096) => new GzipNpmTarballInspector().inspect(chunks(bytes, size));

function split(body, size) {
  const reader = new NpmPublishBody(64 * 1024);
  const out = [];
  for (let offset = 0; offset < body.length; offset += size)
    out.push(...reader.push(body.subarray(offset, offset + size)));
  return { tarball: Buffer.concat(out), document: reader.document(), reader };
}
const publishBody = (tarball, extra = {}) =>
  Buffer.from(
    JSON.stringify({
      _id: 'com.example.tools',
      name: 'com.example.tools',
      'dist-tags': { latest: '1.2.0' },
      versions: { '1.2.0': { name: 'com.example.tools', version: '1.2.0', data: 'keep me' } },
      _attachments: {
        'com.example.tools-1.2.0.tgz': {
          content_type: 'application/octet-stream',
          data: tarball.toString('base64'),
          length: tarball.length,
        },
      },
      ...extra,
    }),
  );

test('a publish body yields its tarball and a document without it, at any chunk size', () => {
  for (const length of [0, 1, 2, 3, 100, 5000]) {
    const tarball = randomBytes(length);
    const body = publishBody(tarball);
    for (const size of [1, 2, 3, 5, 7, 64, 1000, body.length]) {
      const { tarball: out, document, reader } = split(body, size);
      assert.ok(out.equals(tarball), `length ${length}, chunks of ${size}`);
      assert.equal(reader.attachments, 1);
      assert.equal(document._attachments['com.example.tools-1.2.0.tgz'].data, '');
      assert.equal(document.versions['1.2.0'].data, 'keep me', 'only the attachment data');
      assert.equal(document['dist-tags'].latest, '1.2.0');
    }
  }
});

test('a key written with escapes still names the attachments', () => {
  const tarball = randomBytes(10);
  const body = Buffer.from(
    `{"_attach\\u006dents":{"a.tgz":{"data":"${tarball.toString('base64')}"}},"name":"x"}`,
  );
  const { tarball: out, document } = split(body, 3);
  assert.ok(out.equals(tarball));
  assert.deepEqual(document, { _attachments: { 'a.tgz': { data: '' } }, name: 'x' });
});

test('a publish body is refused for a second tarball, bad base64 or an oversized document', () => {
  const data = Buffer.from('abc').toString('base64');
  const refused = (text, pattern, limit = 64 * 1024) => {
    const reader = new NpmPublishBody(limit);
    assert.throws(() => {
      reader.push(Buffer.from(text));
      reader.document();
    }, pattern);
  };
  refused(`{"_attachments":{"a":{"data":"${data}"},"b":{"data":"${data}"}}}`, /exactly one/);
  refused('{"_attachments":{"a":{"data":"ab\\/c"}}}', /plain base64/);
  refused('{"_attachments":{"a":{"data":"ab*c"}}}', /plain base64/);
  refused('{"_attachments":{"a":{"data":"ab==cd=="}}}', /padding/);
  refused('{"_attachments":{"a":{"data":"abc"}}}', /Truncated/);
  refused(`{"readme":"${'x'.repeat(2000)}"}`, /too large/, 1024);
  refused('{"_attachments":{"a":{"data":"YWJj"}}', /Malformed/);
});

test('the inspector hashes every byte and reads package.json past other entries', async () => {
  const big = randomBytes(300_000);
  const archive = gzipSync(
    tar(
      entry('package/', Buffer.alloc(0), '5'),
      entry('package/Runtime/Big.bin', big),
      entry('package/package.json', manifest({ unity: '2022.3' })),
    ),
  );
  const facts = await inspect(archive, 777);
  assert.equal(facts.size, archive.length);
  assert.equal(facts.sha1, createHash('sha1').update(archive).digest('hex'));
  assert.equal(facts.sha256, createHash('sha256').update(archive).digest('hex'));
  assert.equal(facts.integrity.sha512, createHash('sha512').update(archive).digest('base64'));
  assert.equal(facts.manifest.unity, '2022.3');
});

test('a pax path names the manifest; nested or missing manifests and other bytes are refused', async () => {
  const long = gzipSync(
    tar(entry('PaxHeader', pax('package/package.json'), 'x'), entry('ignored', manifest())),
  );
  assert.equal((await inspect(long)).manifest.version, '1.2.0');
  const nested = gzipSync(tar(entry('package/sub/package.json', manifest())));
  await assert.rejects(inspect(nested), /no package\.json/);
  await assert.rejects(inspect(randomBytes(2048)), /not a gzip-compressed tar/);
  const json = gzipSync(tar(entry('package/package.json', Buffer.from('{oops'))));
  await assert.rejects(inspect(json), /not valid JSON/);
  const corrupt = tar(entry('package/package.json', manifest()));
  corrupt[150] ^= 0xff;
  await assert.rejects(inspect(gzipSync(corrupt)), /Not a tar archive/);
});

test('publish documents, integrity strings and feed details follow the npm rules', () => {
  const document = JSON.parse(publishBody(Buffer.from('x')).toString());
  document.versions['1.2.0'].dist = { shasum: 'AB'.repeat(20), integrity: 'sha512-x' };
  const parsed = parseNpmPublish(document, 'com.example.tools');
  assert.deepEqual(parsed, {
    version: '1.2.0',
    tags: ['latest'],
    declared: { shasum: 'ab'.repeat(20), integrity: 'sha512-x', length: 1 },
  });
  assert.throws(() => parseNpmPublish(document, 'com.example.other'), /another package/);
  assert.throws(() => parseNpmPublish({ ...document, _attachments: undefined }, 'x'), /Only/);
  assert.throws(
    () => parseNpmPublish({ ...document, 'dist-tags': { latest: '9.9.9' } }, 'com.example.tools'),
    /must name its version/,
  );
  assert.throws(
    () => parseNpmPublish({ ...document, 'dist-tags': { 'v1.2': '1.2.0' } }, 'com.example.tools'),
    /Invalid dist-tag/,
  );

  const digests = { sha1: 'one', sha256: 'two', sha512: 'three' };
  assert.equal(npmIntegrityMatches('sha512-three sha1-one', digests), true);
  assert.equal(npmIntegrityMatches('sha512-three?opt sha384-unknown', digests), true);
  assert.equal(npmIntegrityMatches('sha512-other', digests), false);

  assert.deepEqual(parseNpmDetail('{"name":"@team/tools","tag":"beta","version":"1.0.0-rc.1"}'), {
    name: '@team/tools',
    version: '1.0.0-rc.1',
    tag: 'beta',
  });
  assert.equal(parseNpmDetail('{"name":"Upper"}'), null);
  assert.equal(parseNpmDetail('not json'), null);
});

test('a packument serves each manifest with the registry name, version and dist', () => {
  const packument = npmPackument(
    'com.example.tools',
    [
      {
        version: '1.0.0',
        manifest: { name: 'spoofed', displayName: 'Tools', dist: { tarball: 'elsewhere' } },
        file: 'com.example.tools-1.0.0.tgz',
        shasum: 'a'.repeat(40),
        integrity: 'sha512-x',
        publishedAt: '2026-10-04T10:00:00.000Z',
      },
    ],
    { latest: '1.0.0' },
    'https://arkvory.example/npm/games/com.example.tools/-/',
  );
  const version = packument.versions['1.0.0'];
  assert.equal(version.name, 'com.example.tools');
  assert.equal(version.displayName, 'Tools');
  assert.deepEqual(version.dist, {
    tarball: 'https://arkvory.example/npm/games/com.example.tools/-/com.example.tools-1.0.0.tgz',
    shasum: 'a'.repeat(40),
    integrity: 'sha512-x',
  });
  assert.equal(packument.time['1.0.0'], '2026-10-04T10:00:00.000Z');
});

test('a tarball is read to its end: a second or linked manifest is refused, as npm keeps the last', async () => {
  const twice = gzipSync(
    tar(entry('package/package.json', manifest()), entry('package/package.json', manifest())),
  );
  await assert.rejects(inspect(twice), /more than one package\.json/);
  // pacote drops `.` segments and the first directory: both land on package.json.
  const dotted = gzipSync(
    tar(entry('package/package.json', manifest()), entry('other/./package.json', manifest())),
  );
  await assert.rejects(inspect(dotted), /more than one package\.json/);
  const linked = gzipSync(
    tar(entry('package/package.json', Buffer.alloc(0), '2'), entry('x/package.json', manifest())),
  );
  await assert.rejects(inspect(linked), /regular file/);
  const contiguous = gzipSync(tar(entry('package/package.json', manifest(), '7')));
  assert.equal((await inspect(contiguous)).manifest.version, '1.2.0');
  const hugePax = gzipSync(tar(entry('PaxHeader', Buffer.alloc(65 * 1024, 0x61), 'x')));
  await assert.rejects(inspect(hugePax), /path header is too large/);
});

test('a gzip bomb, a deep publish body and a cancelled inspection stop early', async () => {
  const bomb = gzipSync(tar(entry('package/zeros.bin', Buffer.alloc(80 * 1024 * 1024))));
  assert.ok(bomb.length < 200 * 1024, 'the archive itself is small');
  await assert.rejects(inspect(bomb), /expands too far/);
  const reader = new NpmPublishBody(64 * 1024);
  assert.throws(() => reader.push(Buffer.from('{"a":' + '['.repeat(100))), /nests too deeply/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new GzipNpmTarballInspector().inspect(chunks(gzipSync(tar()), 64), controller.signal),
    { name: 'AbortError' },
  );
});

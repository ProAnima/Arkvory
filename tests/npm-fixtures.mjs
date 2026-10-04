import { gzipSync } from 'node:zlib';

/** One ustar entry: header with checksum, data padded to 512 bytes. */
export function tarEntry(name, data, type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

export const tar = (...entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);

/** A package tarball as npm packs it: `package/package.json` and the files under `package/`. */
export function npmTarball(manifest, files = {}) {
  return gzipSync(
    tar(
      tarEntry('package/package.json', Buffer.from(JSON.stringify(manifest))),
      ...Object.entries(files).map(([path, data]) => tarEntry(`package/${path}`, data)),
    ),
  );
}

/** The body of `npm publish` for one version of a tarball. */
export function npmPublishBody(name, version, tarball, tags = ['latest']) {
  return JSON.stringify({
    _id: name,
    name,
    'dist-tags': Object.fromEntries(tags.map((tag) => [tag, version])),
    versions: { [version]: { name, version } },
    _attachments: {
      [`${name}-${version}.tgz`]: {
        content_type: 'application/octet-stream',
        data: tarball.toString('base64'),
        length: tarball.length,
      },
    },
  });
}

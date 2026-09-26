import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { readdir, lstat, readFile, open, realpath } from 'node:fs/promises';
import { resolve, relative, join, basename, isAbsolute, sep } from 'node:path';
import { ArkvoryClient, ArkvoryHttpError } from '@proanima/arkvory-sdk';

const args = process.argv.slice(2);
const source = args.find((value) => !value.startsWith('--'));
if (
  !source ||
  args.filter((value) => !value.startsWith('--')).length !== 1 ||
  args.some((value) => value.startsWith('--') && !['--apply', '--replace-assets'].includes(value))
)
  throw new Error('Usage: npm run import -- DIRECTORY [--apply] [--replace-assets]');
const root = await realpath(resolve(source));
if (!(await lstat(root)).isDirectory() || (await lstat(resolve(source))).isSymbolicLink())
  throw new Error('Source must be a real directory');
const apply = args.includes('--apply');
const replace = args.includes('--replace-assets');
const repository = process.env.ARKVORY_REPOSITORY ?? 'releases';
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(repository)) throw new Error('Invalid repository');
const client = apply
  ? new ArkvoryClient(process.env.ARKVORY_BASE_URL ?? 'http://127.0.0.1:8080', () => token)
  : undefined;
let token = '';
if (apply) {
  if (!process.env.ARKVORY_TOKEN_FILE || !process.env.ARKVORY_IMPORT_JOURNAL)
    throw new Error('ARKVORY_TOKEN_FILE and ARKVORY_IMPORT_JOURNAL are required for --apply');
  for (const filename of [
    await realpath(process.env.ARKVORY_TOKEN_FILE),
    resolve(process.env.ARKVORY_IMPORT_JOURNAL),
  ]) {
    const path = relative(root, filename);
    if (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)))
      throw new Error('Token and journal must be outside the source directory');
  }
  token = (await readFile(process.env.ARKVORY_TOKEN_FILE, 'utf8')).trim();
}
const journal = apply ? await open(process.env.ARKVORY_IMPORT_JOURNAL, 'a', 0o600) : undefined;
let count = 0;
async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported');
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) {
      if (++count > 100000) throw new Error('Import exceeds 100000 files');
      yield path;
    } else throw new Error('Non-regular source entry');
  }
}
try {
  for await (const file of files(root)) {
    const path = relative(root, file).replaceAll('\\', '/');
    if (
      path.split('/').some((s) => !s || s === '.' || s === '..') ||
      path.includes(':') ||
      path.length > 1024
    )
      throw new Error('Unsafe asset path');
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 5 * 1024 ** 3)
      throw new Error('Source file must be regular and at most 5 GiB');
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    const sha256 = hash.digest('hex');
    if (!client) {
      process.stdout.write(
        JSON.stringify({
          path,
          size: String(info.size),
          sha256,
          kind: path.endsWith('.upack') ? 'upack' : 'asset',
        }) + '\n',
      );
      continue;
    }
    const key = createHash('sha256')
      .update(JSON.stringify([repository, path, sha256]))
      .digest('hex');
    const upload = await client.create(repository, `import:${key}`, {
      name: basename(file),
      size: String(info.size),
      sha256,
      labels: ['imported'],
      metadata: {},
    });
    const ready = await client.resume(repository, upload.id, await openAsBlob(file));
    if (path.endsWith('.upack')) await client.registerPackage(repository, ready.id);
    else {
      let prior;
      try {
        prior = await client.asset(repository, path);
      } catch (error) {
        if (!(error instanceof ArkvoryHttpError && error.status === 404)) throw error;
      }
      if (prior && prior.artifactId !== ready.id && !replace)
        throw new Error('Asset already exists; inspect before using --replace-assets');
      if (prior?.artifactId !== ready.id)
        await client.setAsset(repository, path, ready.id, prior?.revision ?? 0);
    }
    const response = await client.download(repository, ready.id);
    if (!response.body) throw new Error('Missing verification stream');
    const verified = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      verified.update(chunk);
    }
    if (size !== info.size || verified.digest('hex') !== sha256)
      throw new Error('Read-back integrity verification failed');
    await journal.writeFile(
      JSON.stringify({
        path,
        id: ready.id,
        size: String(size),
        sha256,
        verifiedAt: new Date().toISOString(),
      }) + '\n',
    );
    await journal.sync();
    process.stdout.write(JSON.stringify({ path, id: ready.id, status: 'verified' }) + '\n');
  }
} finally {
  await journal?.close();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { stage } from '../apps/deploy/dist/staging.js';

const entries = {
  'apps/api/dist/main.js': 'api',
  'apps/worker/dist/main.js': 'worker',
  'apps/api/dist/migrate.js': 'migrate',
  'apps/deploy/dist/main.js': 'deploy',
  'deploy/launcher.mjs': 'launcher',
  'package.json': '{}',
};
async function archive(directory) {
  const path = join(directory, 'arkvory-runtime.zip');
  const zip = new ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(path));
  for (const [name, text] of Object.entries(entries)) zip.addBuffer(Buffer.from(text), name);
  zip.end();
  await done;
  return path;
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-staging-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'root');
  await mkdir(root);
  const path = await archive(directory);
  let downloads = 0;
  const release = {
    format: 1,
    version: '1.2.3',
    commit: 'c'.repeat(40),
    schema: 1,
    archiveSha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    setupSha256: 'a'.repeat(64),
  };
  const source = {
    release,
    archive: async () => {
      downloads++;
      return path;
    },
  };
  return {
    root,
    source,
    release: join(root, 'releases', '1.2.3'),
    downloads: () => downloads,
  };
}
const differs = /Existing release differs from its verified archive/;

test('an existing release directory is reused only after it matches its verified archive', async (t) => {
  const f = await fixture(t);
  await stage(f.root, f.source);
  assert.equal(await readFile(join(f.release, 'apps/api/dist/main.js'), 'utf8'), 'api');
  // Reuse reads the archive again and compares every entry; nothing is trusted by name.
  await stage(f.root, f.source);
  assert.equal(f.downloads(), 2);
  assert.equal(await readFile(join(f.release, 'deploy/launcher.mjs'), 'utf8'), 'launcher');
});

test('a release directory that differs from its archive is refused and left untouched', async (t) => {
  for (const change of [
    (release) => writeFile(join(release, 'apps/api/dist/main.js'), 'other'),
    (release) => writeFile(join(release, 'apps/api/dist/extra.js'), 'extra'),
    (release) => rm(join(release, 'package.json')),
    (release) => writeFile(join(release, 'release.json'), '{}'),
    async (release) => {
      const outside = join(release, '..', '..', '..', 'outside');
      await mkdir(outside);
      await rename(join(release, 'deploy'), join(outside, 'deploy'));
      await symlink(join(outside, 'deploy'), join(release, 'deploy'), 'junction');
      // A recursive removal does not take a Windows junction.
      return () => unlink(join(release, 'deploy'));
    },
    ...(process.platform === 'win32'
      ? []
      : [(release) => chmod(join(release, 'package.json'), 0o666)]),
  ]) {
    const f = await fixture(t);
    await stage(f.root, f.source);
    const undo = await change(f.release);
    await assert.rejects(stage(f.root, f.source), differs);
    if (typeof undo === 'function') await undo();
    // The comparison copy is removed; the refused directory stays for inspection.
    assert.deepEqual(await readdir(join(f.root, 'releases')), ['1.2.3']);
  }
  // A directory placed under the version's name with a matching release.json is not a release.
  const f = await fixture(t);
  await mkdir(f.release, { recursive: true });
  await writeFile(join(f.release, 'release.json'), JSON.stringify(f.source.release));
  await writeFile(join(f.release, 'package.json'), '{}');
  await assert.rejects(stage(f.root, f.source), differs);
  assert.equal(await readFile(join(f.release, 'package.json'), 'utf8'), '{}');
});

test('reuse never accepts an archive whose checksum differs from the release', async (t) => {
  const f = await fixture(t);
  await stage(f.root, f.source);
  const changed = { ...f.source, release: { ...f.source.release, archiveSha256: 'b'.repeat(64) } };
  await writeFile(join(f.release, 'release.json'), JSON.stringify(changed.release));
  await assert.rejects(stage(f.root, changed), /Release checksum mismatch/);
});

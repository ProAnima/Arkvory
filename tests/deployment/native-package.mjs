import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { verifyNativeFiles } from '../../scripts/native-files.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'arkvory-native-gate-'));
const base = process.env.ARKVORY_RELEASE_ARTIFACT ?? join(temporary, 'base');
const output = resolve(process.env.ARKVORY_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
assert.ok(process.env.npm_execpath, 'Run through npm gate');
if (!process.env.ARKVORY_RELEASE_ARTIFACT)
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', '0.0.1', base],
    { stdio: 'inherit' },
  );
await mkdir(output, { recursive: true });
execFileSync(process.execPath, ['scripts/package-native.mjs', base, output], { stdio: 'inherit' });
const release = JSON.parse(await readFile(join(base, 'arkvory-release.json'), 'utf8'));
await verifyNativeFiles(output, release.version, release.commit, [process.platform]);
await access(
  join(output, process.platform === 'win32' ? 'Arkvory-Setup-x64.exe' : 'Arkvory-amd64.deb'),
);
console.log('Native package compiled; pinned dependencies and release identity verified');
// Kept on failure for diagnosis; the native packages themselves live in `output`.
await rm(temporary, { recursive: true, force: true, maxRetries: 3 });

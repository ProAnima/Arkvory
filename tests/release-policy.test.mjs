import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { inspectReleaseWorkflow } from '../scripts/policy/release-workflow.mjs';
import { releaseFiles, sha256, verifyReleaseFiles } from '../scripts/release-files.mjs';

test('release workflow rejects privilege escalation, unchecked bytes and acceptance bypass', async () => {
  const original = await readFile('.github/workflows/release.yml', 'utf8');
  assert.deepEqual(inspectReleaseWorkflow(original), []);
  for (const mutate of [
    (w) => {
      w.jobs.build.permissions = { contents: 'write' };
    },
    (w) => {
      w.jobs.publish.needs = ['build'];
    },
    (w) => {
      w.jobs.acceptance.strategy.matrix.os = ['ubuntu-24.04'];
    },
    (w) => {
      w.jobs.acceptance.env = {};
    },
    (w) => {
      w.jobs.publish.steps.push({ run: 'npm ci' });
    },
    (w) => {
      w.jobs.publish.steps.find((s) => s.uses?.startsWith('actions/download-artifact')).with[
        'run-id'
      ] = 123;
    },
    (w) => {
      w.jobs.build.steps.find((s) => s.run === 'npm run gate -- release').if = 'false';
    },
    (w) => {
      w.jobs.publish.if = 'always()';
    },
    (w) => {
      w.jobs.build.steps.find((s) => s.run === 'npm run gate -- release').if = false;
    },
    (w) => {
      w.jobs.unchecked = { permissions: { contents: 'write' }, steps: [] };
    },
  ]) {
    const workflow = parse(original);
    mutate(workflow);
    assert.ok(inspectReleaseWorkflow(stringify(workflow)).length);
  }
});
test('release inventory binds all launchers and runtime bytes to the tested commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-release-policy-'));
  for (const name of releaseFiles) await writeFile(join(directory, name), 'test fixture');
  const manifest = {
    version: '1.2.3',
    commit: 'a'.repeat(40),
    archiveSha256: await sha256(join(directory, 'depot-runtime.zip')),
    setupSha256: await sha256(join(directory, 'depot-setup.mjs')),
  };
  await writeFile(join(directory, 'depot-release.json'), JSON.stringify(manifest));
  const files = {};
  for (const name of releaseFiles) files[name] = await sha256(join(directory, name));
  await writeFile(
    join(directory, 'release-checksums.json'),
    JSON.stringify({ format: 1, ...manifest, files }),
  );
  await verifyReleaseFiles(directory, manifest.version, manifest.commit);
  await assert.rejects(verifyReleaseFiles(directory, manifest.version, 'b'.repeat(40)), /identity/);
  await writeFile(join(directory, 'Depot-Windows.zip'), 'tampered launcher');
  await assert.rejects(
    verifyReleaseFiles(directory, manifest.version, manifest.commit),
    /Checksum/,
  );
  await writeFile(join(directory, 'unexpected.exe'), 'unreviewed');
  await assert.rejects(
    verifyReleaseFiles(directory, manifest.version, manifest.commit),
    /Unexpected/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseModuleSelections,
  planBuiltinModules,
  readModuleSelections,
  startupReason,
} from '../packages/infrastructure/dist/index.js';

/** What an operator reads in `startup.failed` or `worker.unavailable` for a start refused so. */
function reasonOf(start) {
  try {
    start();
  } catch (error) {
    return startupReason(error);
  }
  throw new Error('The start was not refused');
}

test('a refused module plan reaches the startup log with its codes and module ids', () => {
  const reason = reasonOf(() =>
    planBuiltinModules(
      '1.0.0',
      parseModuleSelections({ format: 1, modules: { upack: { enabled: false } } }),
    ),
  );
  assert.equal(reason, 'Module plan refused: core_disabled(upack)');
});

test('a field named like a secret keeps its pointer and problem in the startup log', () => {
  const field = reasonOf(() =>
    parseModuleSelections({ format: 1, modules: { npm: { enabled: true, token: 'abc' } } }),
  );
  assert.equal(field, 'Invalid ARKVORY_MODULES_FILE: unknown field /modules/npm/token');
  const setting = reasonOf(() =>
    planBuiltinModules(
      '1.0.0',
      parseModuleSelections({
        format: 1,
        modules: { npm: { enabled: true, config: { password: 'hunter2' } } },
      }),
    ),
  );
  assert.equal(setting, 'Invalid ARKVORY_MODULES_FILE: unknown_field /modules/npm/config/password');
  assert.doesNotMatch(field + setting, /abc|hunter2|redacted/);
});

test('the modules file is an absolute path, read at most one MiB far in bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-modules-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'modules.json');
  await writeFile(file, '{"format": 1, "modules": {"npm": {"enabled": false}}}');
  assert.deepEqual(
    [...(await readModuleSelections(file))],
    [['npm', { enabled: false, config: undefined }]],
  );
  // Installed services start in the release directory, which the next update replaces.
  await assert.rejects(
    readModuleSelections('config/modules.json'),
    /ARKVORY_MODULES_FILE must be an absolute path/,
  );
  // 600 000 characters of two bytes each: below one MiB in characters, above it in bytes.
  const padded = `{"format": 1, "pad": "${'é'.repeat(600_000)}"}`;
  assert.ok(padded.length < 1024 * 1024);
  await writeFile(file, padded);
  await assert.rejects(readModuleSelections(file), /Invalid ARKVORY_MODULES_FILE: file too large/);
  await assert.rejects(
    readModuleSelections(join(directory, 'absent.json')),
    /ARKVORY_MODULES_FILE cannot be read/,
  );
  await assert.rejects(readModuleSelections(directory), /ARKVORY_MODULES_FILE cannot be read/);
});

test('the operator approves the data directory of a module in the modules file', () => {
  const read = (resources) =>
    parseModuleSelections({ format: 1, modules: { 'op-index': { enabled: true, resources } } });
  assert.deepEqual(read({ dataMiB: 64, dataFiles: 1000 }).get('op-index').resources, {
    dataMiB: 64,
    dataFiles: 1000,
  });
  assert.equal(read(undefined).get('op-index').resources, undefined);
  for (const [value, pointer] of [
    [{ dataMiB: -1, dataFiles: 1 }, '/modules/op-index/resources/dataMiB'],
    [{ dataMiB: 1, dataFiles: 1.5 }, '/modules/op-index/resources/dataFiles'],
    [{ dataMiB: 1 }, '/modules/op-index/resources/dataFiles'],
    [{ dataMiB: 1, dataFiles: 1, inodes: 1 }, 'unknown field /modules/op-index/resources/inodes'],
    ['big', '/modules/op-index/resources'],
  ])
    assert.throws(() => read(value), { message: `Invalid ARKVORY_MODULES_FILE: ${pointer}` });
});

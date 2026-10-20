import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectModulePackage } from '../packages/signing/dist/index.js';
import { packModule } from '../scripts/module-signing.mjs';
import { manifestOf, temporaryDirectory, testHost } from './module-fixtures.mjs';

async function fixture(t) {
  const directory = await temporaryDirectory(t);
  const source = join(directory, 'source');
  await mkdir(join(source, 'files'), { recursive: true });
  await writeFile(join(source, 'module.json'), JSON.stringify(manifestOf()));
  await writeFile(join(source, 'files/main.mjs'), 'export {};\n');
  return { directory, source, ...testHost() };
}

test('module pack: fixed epoch reproduces signed archive accepted by the loader', async (t) => {
  const { directory, source, host, module } = await fixture(t);
  const first = join(directory, 'first.tgz'),
    second = join(directory, 'second.tgz');
  assert.deepEqual(await packModule(source, first, module, null, '1792454400'), {
    signingTimestamp: 1792454400,
  });
  await utimes(join(source, 'files/main.mjs'), 1, 1);
  await packModule(source, second, module, null, '1792454400');
  assert.deepEqual(await readFile(first), await readFile(second));
  await inspectModulePackage(first, host);
  await inspectModulePackage(second, host);
  const other = join(directory, 'other.tgz');
  await packModule(source, other, module, null, '1792454401');
  assert.notDeepEqual(await readFile(first), await readFile(other));
  await inspectModulePackage(other, host);
});

test('module pack: SOURCE_DATE_EPOCH reaches the CLI default without changing trust', async (t) => {
  const { directory, source, module } = await fixture(t);
  const previous = process.env.SOURCE_DATE_EPOCH;
  try {
    process.env.SOURCE_DATE_EPOCH = '0';
    const first = join(directory, 'environment.tgz'),
      second = join(directory, 'explicit.tgz');
    await packModule(source, first, module);
    await packModule(source, second, module, null, '0');
    assert.deepEqual(await readFile(first), await readFile(second));
  } finally {
    if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previous;
  }
});

test('module pack: malformed or out-of-range epoch fails before publishing an archive', async (t) => {
  const { directory, source, module } = await fixture(t);
  const output = join(directory, 'invalid.tgz');
  for (const value of [
    '',
    ' ',
    '-1',
    '+1',
    '01',
    '1.5',
    '1e3',
    '253402300800',
    '9007199254740993',
    null,
    1,
  ]) {
    await assert.rejects(packModule(source, output, module, null, value), /SOURCE_DATE_EPOCH/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

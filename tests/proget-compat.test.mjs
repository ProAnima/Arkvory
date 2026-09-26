import test from 'node:test';
import assert from 'node:assert/strict';
import { ProGetDownloads } from '@proanima/arkvory-proget-compat';

test('Common Packages download resolves only an explicit UPack version', async () => {
  const calls = [];
  const catalog = {
    async resolvePackage(_principal, repository, group, name, version) {
      calls.push({ repository, group, name, version });
      return version === '1.0.0'
        ? 'old'
        : version === '2.0.0' || version === undefined
          ? 'new'
          : null;
    },
  };
  const downloads = new ProGetDownloads(catalog);
  const principal = { id: 'reader', repositories: ['releases'], permissions: ['read'] };

  assert.equal(
    await downloads.common(principal, 'releases', {
      group: 'Tools',
      name: 'Example',
      version: '1.0.0',
    }),
    'old',
  );
  assert.deepEqual(calls, [
    { repository: 'releases', group: 'Tools', name: 'Example', version: '1.0.0' },
  ]);
  assert.equal(
    await downloads.common(principal, 'releases', { name: 'Example', version: '2.0.0' }),
    'new',
  );
  assert.deepEqual(calls[1], {
    repository: 'releases',
    group: '',
    name: 'Example',
    version: '2.0.0',
  });
  assert.equal(
    await downloads.universal(principal, 'releases', 'Tools/Example', { latest: '' }),
    'new',
  );
  assert.deepEqual(calls[2], {
    repository: 'releases',
    group: 'Tools',
    name: 'Example',
    version: undefined,
  });

  for (const query of [
    { name: 'Example' },
    { name: 'Example', version: ['1.0.0', '2.0.0'] },
    { name: 'Example', version: '1.0.0', purl: 'pkg:generic/Example@1.0.0' },
  ]) {
    await assert.rejects(downloads.common(principal, 'releases', query), { code: 'invalid_input' });
  }
  await assert.rejects(
    downloads.common(principal, 'releases', { name: 'Example', version: '3.0.0' }),
    { code: 'not_found' },
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProGetDownloads } from '@proanima/depot-proget-compat';

test('Common Packages download resolves only an explicit UPack version', async () => {
  const calls = [];
  const catalog = {
    async packages(_principal, repository, group, name) {
      calls.push({ repository, group, name });
      return [
        { version: '2.0.0', artifactId: 'new' },
        { version: '1.0.0', artifactId: 'old' },
      ];
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
  assert.deepEqual(calls, [{ repository: 'releases', group: 'Tools', name: 'Example' }]);
  assert.equal(
    await downloads.common(principal, 'releases', { name: 'Example', version: '2.0.0' }),
    'new',
  );
  assert.deepEqual(calls[1], { repository: 'releases', group: '', name: 'Example' });

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

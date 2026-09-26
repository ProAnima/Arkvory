import test from 'node:test';
import assert from 'node:assert/strict';
import { organizePackages, parsePackageListOptions } from '@proanima/arkvory-application';

const entries = [
  { group: 'Tools', name: 'Example', version: '1.9.0', artifactId: 'a', manifest: {} },
  { group: 'Tools', name: 'Example', version: '1.10.0', artifactId: 'b', manifest: {} },
  { group: 'Games', name: 'Example', version: '2.0.0', artifactId: 'c', manifest: {} },
];

test('package ordering uses SemVer and grouping preserves distinct UPack identities', () => {
  const result = organizePackages(entries, {
    sort: 'version',
    direction: 'desc',
    groupBy: 'package',
  });
  assert.deepEqual(
    result.items.map((item) => item.artifactId),
    ['c', 'b', 'a'],
  );
  assert.deepEqual(
    result.groups.map((group) => [group.group, group.name]),
    [
      ['Games', 'Example'],
      ['Tools', 'Example'],
    ],
  );
  assert.deepEqual(result.groups[1].artifactIds, ['b', 'a']);
  assert.deepEqual(parsePackageListOptions({}), {
    sort: 'group',
    direction: 'asc',
    groupBy: 'none',
  });
  assert.deepEqual(
    organizePackages(entries, parsePackageListOptions({})).items.map((item) => item.artifactId),
    ['c', 'b', 'a'],
  );
  assert.throws(() => parsePackageListOptions({ sort: 'size' }), { code: 'invalid_input' });
});

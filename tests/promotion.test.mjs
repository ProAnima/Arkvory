import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePromotionRequest,
  parseSemVer,
  parseVersionRange,
  requireComment,
  requireStage,
  satisfies,
  compareSemVer,
} from '@proanima/arkvory-domain';
import { parsePackageQuery, PackageResolver } from '@proanima/arkvory-application';
import {
  readPromotionEvents,
  readPromotionResult,
  readResolvedPackage,
  readStagePage,
} from '@proanima/arkvory-contracts';

const id = '11111111-1111-4111-8111-111111111111';
const matches = (range, version, prerelease = false) =>
  satisfies(parseSemVer(version), parseVersionRange(range), prerelease);

test('stage names, comments and promotion requests are validated before storage', () => {
  assert.equal(requireStage('prod'), 'prod');
  for (const bad of ['', 'Prod', '-qa', 'a'.repeat(33), 'a/b', 1])
    assert.throws(() => requireStage(bad), { code: 'invalid_input' });
  assert.equal(requireComment(''), null);
  assert.equal(requireComment('line\nnext\ttab'), 'line\nnext\ttab');
  for (const bad of ['\u0000', 'x'.repeat(1025), '\uD800', 7])
    assert.throws(() => requireComment(bad), { code: 'invalid_input' });
  assert.deepEqual(parsePromotionRequest({ target: 'prod', stages: ['qa', 'beta', 'qa'] }), {
    target: 'prod',
    mode: 'copy',
    stages: ['beta', 'qa'],
    comment: null,
  });
  for (const bad of [
    null,
    {},
    { target: 'Prod' },
    { target: 'prod', mode: 'link' },
    { target: 'prod', stages: Array.from({ length: 17 }, (_, i) => `s${String(i)}`) },
    { target: 'prod', extra: true },
  ])
    assert.throws(() => parsePromotionRequest(bad), { code: 'invalid_input' });
});

test('SemVer ranges follow caret, tilde, x-range, comparator and prerelease rules', () => {
  assert.ok(compareSemVer(parseSemVer('1.0.0-rc.2'), parseSemVer('1.0.0-rc.10')) < 0);
  assert.ok(compareSemVer(parseSemVer('1.0.0-rc.1'), parseSemVer('1.0.0')) < 0);
  assert.ok(compareSemVer(parseSemVer('10.0.0'), parseSemVer('9.99.99')) > 0);
  assert.equal(
    compareSemVer(parseSemVer('99999999999999999999.0.0'), parseSemVer('99999999999999999998.0.0')),
    1,
  );
  const cases = [
    ['^1.2.3', '1.9.0', true],
    ['^1.2.3', '2.0.0', false],
    ['^1.2.3', '1.2.2', false],
    ['^0.2.3', '0.2.9', true],
    ['^0.2.3', '0.3.0', false],
    ['^0.0.3', '0.0.4', false],
    ['~1.2.3', '1.2.9', true],
    ['~1.2.3', '1.3.0', false],
    ['~1', '1.9.9', true],
    ['1.x', '1.5.0', true],
    ['1.x', '2.0.0', false],
    ['1.2.*', '1.2.7', true],
    ['*', '42.0.0', true],
    ['>=1.0.0 <2.0.0', '1.99.0', true],
    ['>=1.0.0 <2.0.0', '2.0.0', false],
    ['>= 1.0.0 < 2.0.0', '1.5.0', true],
    ['1.0.0 - 1.4.0', '1.4.0', true],
    ['1.0.0 - 1.4.0', '1.4.1', false],
    ['<1.2', '1.1.9', true],
    ['<1.2', '1.2.0', false],
    ['>1.2', '1.2.9', false],
    ['>1.2', '1.3.0', true],
    ['^1.0.0 || ^3.0.0', '3.1.0', true],
    ['^1.0.0 || ^3.0.0', '2.1.0', false],
    ['1.2.3', '1.2.3+build.5', true],
    ['<*', '0.0.1', false],
    // Prereleases need explicit opt-in or a comparator on the same core version.
    ['^1.0.0', '1.1.0-rc.1', false],
    ['>=1.1.0-rc.0 <1.2.0', '1.1.0-rc.1', true],
    ['>=1.1.0-rc.0 <1.2.0', '1.1.1-rc.1', false],
    ['^1.0.0', '2.0.0-rc.1', false],
  ];
  for (const [range, version, expected] of cases)
    assert.equal(matches(range, version), expected, `${range} ${version}`);
  assert.equal(matches('^1.0.0', '1.1.0-rc.1', true), true);
  assert.equal(matches('^1.0.0', '2.0.0-rc.1', true), false);
  for (const bad of ['x'.repeat(257), '^1.2.3;', 'abc', '1 || '.repeat(17) + '1'])
    assert.throws(() => parseVersionRange(bad), { code: 'invalid_input' });
});

test('package queries are strict and resolution skips versions outside range or stage', async () => {
  assert.deepEqual(parsePackageQuery({ name: 'app', range: '^1.0', stage: 'prod' }), {
    group: '',
    name: 'app',
    range: '^1.0',
    stage: 'prod',
    prerelease: false,
    order: 'version',
  });
  for (const bad of [
    {},
    { name: 'app', version: '1.0.0', range: '^1' },
    { name: 'app', order: 'promoted' },
    { name: 'app', prerelease: 'yes' },
    { name: 'app', unknown: '1' },
    { name: ['a', 'b'] },
  ])
    assert.throws(() => parsePackageQuery(bad), { code: 'invalid_input' });
  const versions = ['2.0.0-rc.1', '1.4.0', '1.3.0', '0.9.0'];
  const pages = [];
  const store = {
    async candidates(_repository, query, offset, limit) {
      pages.push([query.stage, offset, limit]);
      return versions.slice(offset, offset + limit).map((version, index) => ({
        group: '',
        name: 'app',
        version,
        artifactId: `${String(index)}`,
        sha256: 'a'.repeat(64),
        size: '1',
        publishedAt: new Date(0).toISOString(),
        stagedAt: null,
      }));
    },
    async exact() {
      return null;
    },
  };
  const resolver = new PackageResolver(store, { stages: async () => [] });
  const principal = { id: 'user:1', repositories: ['r'], permissions: ['read'] };
  assert.equal((await resolver.resolve(principal, 'r', { name: 'app' })).version, '1.4.0');
  assert.equal(
    (await resolver.resolve(principal, 'r', { name: 'app', prerelease: 'true' })).version,
    '2.0.0-rc.1',
  );
  assert.equal(
    (await resolver.resolve(principal, 'r', { name: 'app', range: '<1.4' })).version,
    '1.3.0',
  );
  await assert.rejects(resolver.resolve(principal, 'r', { name: 'app', range: '^3' }), {
    code: 'not_found',
  });
  await assert.rejects(resolver.resolve(principal, 'r', { name: 'app', version: '9.9.9' }), {
    code: 'not_found',
  });
  await assert.rejects(resolver.resolve({ ...principal, repositories: [] }, 'r', { name: 'a' }), {
    code: 'forbidden',
  });
});

test('promotion wire readers reject malformed server responses', () => {
  const result = {
    repository: 'prod',
    artifactId: id,
    sourceRepository: 'dev',
    sourceArtifactId: id,
    mode: 'move',
    created: true,
    stages: ['prod'],
  };
  assert.deepEqual(readPromotionResult(result), result);
  for (const bad of [
    { ...result, mode: 'link' },
    { ...result, created: 'yes' },
    { ...result, stages: ['prod', 'prod'] },
    { ...result, artifactId: 'x' },
  ])
    assert.throws(() => readPromotionResult(bad));
  const event = {
    sequence: '1',
    repository: 'dev',
    artifactId: id,
    action: 'promoted',
    stage: null,
    mode: 'copy',
    peerRepository: 'prod',
    peerArtifactId: id,
    actor: 'user:1',
    comment: null,
    occurredAt: new Date(0).toISOString(),
  };
  assert.equal(readPromotionEvents({ items: [event], next: null }).items[0].action, 'promoted');
  assert.throws(() =>
    readPromotionEvents({ items: [{ ...event, action: 'deleted' }], next: null }),
  );
  assert.throws(() => readPromotionEvents({ items: [{ ...event, sequence: '0' }], next: null }));
  const stage = {
    artifactId: id,
    stage: 'qa',
    promotedAt: event.occurredAt,
    actor: 'a',
    comment: null,
  };
  assert.equal(readStagePage({ items: [stage], next: `${id}/qa` }).next, `${id}/qa`);
  assert.throws(() => readStagePage({ items: [{ ...stage, stage: 'QA' }], next: null }));
  const resolved = {
    group: '',
    name: 'app',
    version: '1.0.0',
    artifactId: id,
    sha256: 'b'.repeat(64),
    size: '12',
    publishedAt: event.occurredAt,
    stagedAt: null,
    stages: [],
  };
  assert.deepEqual(readResolvedPackage(resolved), resolved);
  assert.throws(() => readResolvedPackage({ ...resolved, size: '-1' }));
});

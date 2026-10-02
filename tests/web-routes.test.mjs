import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRoute, parseRoute, sameRoute } from '../apps/web/dist/routes.js';
import { quotaBytes, quotaGib } from '../apps/web/dist/storage-quota.js';

test('console links map sections and artifacts without carrying other state', () => {
  assert.deepEqual(parseRoute(''), { kind: 'empty' });
  assert.deepEqual(parseRoute('#/'), { kind: 'empty' });
  assert.deepEqual(parseRoute('#/packages'), { kind: 'view', view: 'packages' });
  assert.deepEqual(parseRoute('#/backups'), { kind: 'view', view: 'backups' });
  assert.deepEqual(parseRoute('#help'), { kind: 'view', view: 'help' });
  assert.deepEqual(parseRoute('#onboarding'), { kind: 'view', view: 'onboarding' });
  assert.deepEqual(parseRoute('#/artifact/team%2Fa/01J%20X'), {
    kind: 'artifact',
    repository: 'team/a',
    id: '01J X',
  });
  for (const unknown of [
    '#/nope',
    '#/packages/extra',
    '#/artifact/releases',
    '#/artifact/%E0%A4%A',
    '#x',
  ])
    assert.deepEqual(parseRoute(unknown), { kind: 'unknown' }, unknown);
  const artifact = { kind: 'artifact', repository: 'team/a', id: '01J X' };
  assert.equal(formatRoute(artifact), '#/artifact/team%2Fa/01J%20X');
  assert.deepEqual(parseRoute(formatRoute(artifact)), artifact);
  assert.equal(sameRoute(parseRoute('#help'), parseRoute('#/help')), true);
  assert.equal(sameRoute(parseRoute('#/help'), parseRoute('#/catalog')), false);
});

test('storage quotas are typed in GiB and sent as exact bytes', () => {
  assert.equal(quotaBytes(''), null);
  assert.equal(quotaBytes(' 50 '), String(50 * 1024 ** 3));
  assert.equal(quotaBytes('0.5'), '536870912');
  assert.equal(quotaBytes('0,25'), '268435456');
  assert.equal(quotaBytes('8388607.999'), '9007199253667250');
  for (const invalid of ['0', '-1', '1.2345', '12x', '8388608'])
    assert.throws(() => quotaBytes(invalid), RangeError, invalid);
  assert.equal(quotaGib('536870912'), '0.5');
  assert.equal(quotaGib(String(50 * 1024 ** 3)), '50');
  assert.equal(quotaGib('1000000000'), '0.931');
  assert.equal(quotaGib(String(2 * 1024 ** 3 - 1)), '2');
});

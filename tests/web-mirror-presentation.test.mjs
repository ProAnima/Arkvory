import test from 'node:test';
import assert from 'node:assert/strict';
import { en, ru } from '../apps/web/dist/messages.js';
import {
  hostOf,
  mirrorReason,
  mirrorState,
  stateKeys,
} from '../apps/web/dist/mirror-presentation.js';

const status = (fields) => ({
  repository: 'releases',
  upstream: 'https://source.example:8443',
  sourceRepository: 'builds',
  mode: 'mirror',
  stages: [],
  phase: 'following',
  seedStep: null,
  cursor: '7',
  head: '7',
  caughtUp: true,
  checkedAt: null,
  syncedAt: null,
  errorCode: null,
  errorAt: null,
  copiedArtifacts: 0,
  copiedBytes: '0',
  ...fields,
});

test('a mirror state is what the person must know: synced, catching up, starting, first copy, stopped', () => {
  assert.equal(mirrorState(status({})), 'synced');
  assert.equal(mirrorState(status({ caughtUp: false })), 'behind');
  assert.equal(mirrorState(status({ phase: 'pending', caughtUp: null })), 'pending');
  assert.equal(mirrorState(status({ phase: 'seeding', caughtUp: null })), 'seeding');
  assert.equal(mirrorState(status({ errorCode: 'unauthorized' })), 'failing');
  // A restored source is read again: no failure, the reason still shows why.
  const behind = status({ phase: 'seeding', caughtUp: null, errorCode: 'mirror_source_behind' });
  assert.equal(mirrorState(behind), 'seeding');
  assert.equal(mirrorReason(behind)?.key, 'mirrorReasonSourceBehind');
  for (const key of Object.values(stateKeys)) assert.ok(en[key] && ru[key], key);
});

test('every stop has words and a next step; a key or an authority comes with its command', () => {
  assert.equal(mirrorReason(status({})), null);
  const refused = mirrorReason(status({ errorCode: 'unauthorized' }));
  assert.equal(refused.key, 'mirrorReasonUnauthorized');
  assert.equal(
    refused.command,
    'arkvory configure --root <root> --mirror releases --mirror-token-file <key file>',
  );
  const untrusted = mirrorReason(status({ errorCode: 'mirror_certificate' }));
  assert.match(untrusted.command, /--mirror releases .*--mirror-ca-file <ca\.pem>$/);
  const unreachable = mirrorReason(status({ errorCode: 'mirror_unreachable' }));
  assert.deepEqual([unreachable.key, unreachable.command], ['mirrorReasonUnreachable', null]);
  assert.equal(unreachable.params.upstream, 'source.example:8443');
  // A code the console does not know yet still names itself.
  const unknown = mirrorReason(status({ errorCode: 'something_new' }));
  assert.deepEqual([unknown.key, unknown.params.code], ['mirrorReasonOther', 'something_new']);
  for (const code of [
    'forbidden',
    'not_found',
    'capacity_exceeded',
    'mirror_mismatch',
    'mirror_source_changed',
    'mirror_delete_blocked',
    'mirror_detached',
    'mirror_package_conflict',
    'mirror_id_taken',
    'mirror_failed',
  ]) {
    const key = mirrorReason(status({ errorCode: code })).key;
    assert.ok(en[key] && ru[key], `${code}: ${key}`);
  }
  assert.equal(hostOf('not a url'), 'not a url');
});

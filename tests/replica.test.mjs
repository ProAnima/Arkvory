import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledges } from '../packages/domain/dist/index.js';
import { parseReplicaCopies } from '../packages/infrastructure/dist/index.js';

test('a write is acknowledged only when the complete copies reach the required number', () => {
  assert.equal(acknowledges({ copies: 2, required: 2, singleCopyUntil: null }), true);
  assert.equal(acknowledges({ copies: 3, required: 2, singleCopyUntil: null }), true);
  assert.equal(acknowledges({ copies: 1, required: 2, singleCopyUntil: null }), false);
  assert.equal(acknowledges({ copies: 0, required: 1, singleCopyUntil: null }), false);
});

test('only a well-formed answer of the replica helper is a state the server acts on', () => {
  const until = '2026-10-10T12:00:00.000Z';
  assert.deepEqual(parseReplicaCopies({ copies: 1, required: 1, singleCopyUntil: until }), {
    copies: 1,
    required: 1,
    singleCopyUntil: until,
  });
  for (const answer of [
    null,
    [],
    'ok',
    { copies: 2 },
    { copies: 2, required: 0, singleCopyUntil: null },
    { copies: -1, required: 2, singleCopyUntil: null },
    { copies: 1.5, required: 2, singleCopyUntil: null },
    { copies: 17, required: 2, singleCopyUntil: null },
    { copies: '2', required: 2, singleCopyUntil: null },
    { copies: 2, required: 2, singleCopyUntil: 'tomorrow' },
    { copies: 2, required: 2, singleCopyUntil: 5 },
  ])
    assert.throws(() => parseReplicaCopies(answer), JSON.stringify(answer));
});

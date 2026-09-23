import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCorsOrigins } from '../apps/api/dist/cors.js';

test('CORS origins are explicit HTTPS or loopback HTTP origins', () => {
  assert.deepEqual(parseCorsOrigins(undefined), []);
  assert.deepEqual(parseCorsOrigins(''), []);
  assert.deepEqual(parseCorsOrigins(' https://ui.example.test/, http://127.0.0.1:3000 '), [
    'https://ui.example.test',
    'http://127.0.0.1:3000',
  ]);
  assert.deepEqual(parseCorsOrigins(['https://ui.example.test', 'https://ui.example.test']), [
    'https://ui.example.test',
  ]);
  for (const input of [
    '*',
    'null',
    'http://ui.example.test',
    'https://user:pass@ui.example.test',
    'https://ui.example.test/path',
    'https://ui.example.test?token=x',
    ['https://ui.example.test', 42],
    {},
  ])
    assert.throws(() => parseCorsOrigins(input));
});

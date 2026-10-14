import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetChangeMethod, isFleetReadPath } from '../packages/contracts/dist/index.js';

test('a controller forwards exactly the listed reads: every spelling of a dot segment is refused', () => {
  for (const path of [
    '/api/v1/repositories',
    '/api/v1/repositories/releases/search?q=a%20b',
    '/api/v1/repositories/releases/artifacts/abc/annotations',
    '/api/v1/repositories/releases/assets/page?prefix=tools/',
    '/api/v1/system/downloads/settings',
  ])
    assert.equal(isFleetReadPath(path), true, path);
  for (const path of [
    '/api/v1/repositories/.%2e/artifacts/x/annotations',
    '/api/v1/repositories/%2e/search',
    '/api/v1/repositories/%2E%2e',
    '/api/v1/repositories/./search',
    '/api/v1/repositories/../system/updates/requests',
    '/api/v1/repositories/a%2fb/search',
    '/api/v1/repositories/a%5cb/search',
    '/api/v1/repositories/releases/artifacts/x/content',
    '/api/v1/repositories/releases/asset/content?path=a',
    '//evil.example/api/v1/repositories',
    'https://evil.example/api/v1/repositories',
    '/api/v1/repositories#x',
  ])
    assert.equal(isFleetReadPath(path), false, path);
});

test('a change has one method and an exact path, without a query', () => {
  assert.equal(fleetChangeMethod('/api/v1/system/downloads/settings'), 'PUT');
  assert.equal(fleetChangeMethod('/api/v1/system/updates/requests'), 'POST');
  assert.equal(fleetChangeMethod('/api/v1/system/downloads/settings?x=1'), undefined);
  assert.equal(fleetChangeMethod('/api/v1/system/updates'), undefined);
});

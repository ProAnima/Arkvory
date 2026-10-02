import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { authorizeAction } from '@proanima/arkvory-domain';
import { parseMirrorSettings } from '@proanima/arkvory-infrastructure';

const tokenFile = resolve('/etc/arkvory/mirror.token');
const entry = (change = {}) => ({
  repository: 'releases',
  upstream: 'https://arkvory.example',
  sourceRepository: 'releases',
  tokenFile,
  ...change,
});

test('mirror settings accept an HTTPS origin and refuse anything that would leak the key', () => {
  assert.deepEqual(parseMirrorSettings({ mirrors: [entry()] }), [entry()]);
  assert.equal(
    parseMirrorSettings({ mirrors: [entry({ upstream: 'https://arkvory.example/' })] })[0].upstream,
    'https://arkvory.example',
  );
  // Plain HTTP only to this host (tests, a local TLS proxy).
  assert.equal(
    parseMirrorSettings({ mirrors: [entry({ upstream: 'http://127.0.0.1:8080' })] })[0].upstream,
    'http://127.0.0.1:8080',
  );
  for (const [change, field] of [
    [{ upstream: 'http://arkvory.example' }, 'upstream'],
    [{ upstream: 'https://user:secret@arkvory.example' }, 'upstream'],
    [{ upstream: 'https://arkvory.example/api' }, 'upstream'],
    [{ upstream: 'https://arkvory.example/?key=1' }, 'upstream'],
    [{ repository: 'Releases' }, 'repository'],
    [{ sourceRepository: '../x' }, 'sourceRepository'],
    [{ tokenFile: 'relative.token' }, 'tokenFile'],
    [{ caFile: tokenFile }, 'unknown field'],
  ])
    assert.throws(() => parseMirrorSettings({ mirrors: [entry(change)] }), new RegExp(field));
  assert.throws(() => parseMirrorSettings({ mirrors: [entry(), entry()] }), /duplicate repository/);
  assert.throws(() => parseMirrorSettings({ mirrors: [], extra: true }), /unknown field/);
  assert.deepEqual(parseMirrorSettings({ mirrors: [] }), []);
  // Import mode: stages are product stage names, distinct, 1 to 16.
  assert.deepEqual(
    parseMirrorSettings({ mirrors: [entry({ stages: ['release', 'hotfix'] })] })[0].stages,
    ['release', 'hotfix'],
  );
  for (const stages of [[], ['Release'], ['release', 'release'], 'release'])
    assert.throws(() => parseMirrorSettings({ mirrors: [entry({ stages })] }), /stages/);
});

test('a mirrored repository refuses every change and allows every read, for any credential', () => {
  const fileKey = {
    credential: 'file-key',
    id: 'ci',
    repositories: ['releases', 'other'],
    permissions: ['read', 'write'],
    readOnlyRepositories: ['releases'],
  };
  const managed = {
    credential: 'service-key',
    id: 'service:x',
    repositories: [],
    permissions: [],
    managed: {
      accountId: 'x',
      keyId: 'k',
      bindings: [
        {
          resource: { kind: 'repository', id: 'releases' },
          actions: ['artifact.delete', 'artifact.read', 'upload.create', 'annotation.write'],
        },
      ],
    },
    readOnlyRepositories: ['releases'],
  };
  const refused = (principal, action, legacy) =>
    assert.throws(
      () => authorizeAction(principal, 'releases', action, legacy),
      (error) => error.code === 'conflict' && error.reason === 'mirror_read_only',
      action,
    );
  refused(fileKey, 'upload.create', ['write']);
  refused(fileKey, 'artifact.promote', ['read', 'write']);
  refused(managed, 'artifact.delete', null);
  refused(managed, 'annotation.write', ['write']);
  authorizeAction(fileKey, 'releases', 'content.read', ['read']);
  authorizeAction(managed, 'releases', 'artifact.read', ['read']);
  // Other repositories of the same installation stay writable.
  authorizeAction(fileKey, 'other', 'upload.create', ['write']);
  // A missing grant is still a missing grant, not a mirror conflict.
  assert.throws(
    () =>
      authorizeAction({ ...fileKey, permissions: ['read'] }, 'releases', 'upload.create', [
        'write',
      ]),
    (error) => error.code === 'forbidden',
  );
});

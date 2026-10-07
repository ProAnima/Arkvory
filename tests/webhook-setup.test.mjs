import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allowedNetworks,
  configureWebhook as configure,
  receiverUrl,
  webhookFileAccess,
} from '../apps/deploy/dist/webhook-setup.js';
import {
  CONTAINER_USER,
  atomicText,
  restoreFile,
  snapshotFile,
} from '../apps/deploy/dist/files.js';
import { removeTestDirectory } from './helpers.mjs';
import { selfSignedCertificate } from './tls-certificate.mjs';

// Compose secrets are chowned to the container user; a test that is not root can only own them.
const containerUser = process.getuid?.() ?? CONTAINER_USER;
const configureWebhook = (root, state, change, control) =>
  configure(root, state, change, control, containerUser);

const release = { version: '1.0.0', commit: 'c', schema: 33, archiveSha256: 'a', setupSha256: 's' };
const secret = 'a-long-random-signing-secret-1';
const other = 'the-next-signing-secret-2026';

async function installation(t, mode = 'systemd') {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-webhook-setup-'));
  t.after(() => removeTestDirectory(root));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify({ ARKVORY_PORT: '8080' }));
  const secretFile = join(root, 'ci.secret');
  const nextFile = join(root, 'ci.next');
  await writeFile(secretFile, `${secret}\n`);
  await writeFile(nextFile, `${other}\n`);
  return { root, secretFile, nextFile, state: { mode, current: release } };
}

function services(fail = 0) {
  const calls = [];
  let ready = 0;
  return {
    calls,
    stop: async () => calls.push('stop'),
    start: async () => calls.push('start'),
    healthy: async () => {
      calls.push('healthy');
      if (++ready === fail) throw new Error('readiness failed');
    },
  };
}

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = (path) =>
  readFile(path).then(
    () => true,
    () => false,
  );
const subscription = (f, extra = {}) => ({
  id: 'ci',
  repository: 'releases',
  url: 'https://ci.example.com/hooks/arkvory',
  secretFile: f.secretFile,
  ...extra,
});

test('attaching copies the secret, writes the subscription and the setting, and restarts', async (t) => {
  const f = await installation(t);
  const control = services();
  assert.equal(await configureWebhook(f.root, f.state, subscription(f), control), 'attached');
  const directory = join(f.root, 'config/webhooks');
  assert.equal(
    (await json(join(f.root, 'config/runtime.json'))).ARKVORY_WEBHOOKS_FILE,
    join(directory, 'webhooks.json'),
  );
  assert.deepEqual((await json(join(directory, 'webhooks.json'))).webhooks, [
    {
      id: 'ci',
      repository: 'releases',
      url: 'https://ci.example.com/hooks/arkvory',
      secretFile: join(directory, 'ci.secret'),
    },
  ]);
  assert.equal((await readFile(join(directory, 'ci.secret'), 'utf8')).trim(), secret);
  assert.deepEqual(control.calls, ['stop', 'start', 'healthy']);
  assert.equal(
    await exists(join(f.root, 'config/compose.webhooks.yml')),
    false,
    'not a Compose installation',
  );
});

test('a second call replaces its subscription; others stay; detaching removes files and settings', async (t) => {
  const f = await installation(t);
  await configureWebhook(f.root, f.state, subscription(f), services());
  await configureWebhook(
    f.root,
    f.state,
    subscription(f, {
      id: 'deploy',
      url: 'https://deploy.example.com/h',
      actions: ['artifact.publish', 'stage.add'],
    }),
    services(),
  );
  await configureWebhook(
    f.root,
    f.state,
    subscription(f, { url: 'https://ci.example.com/new' }),
    services(),
  );
  const file = join(f.root, 'config/webhooks/webhooks.json');
  const list = (await json(file)).webhooks;
  assert.deepEqual(list.map((hook) => hook.id).sort(), ['ci', 'deploy']);
  assert.equal(list.find((hook) => hook.id === 'ci').url, 'https://ci.example.com/new');
  assert.deepEqual(list.find((hook) => hook.id === 'deploy').actions, [
    'artifact.publish',
    'stage.add',
  ]);

  assert.equal(await configureWebhook(f.root, f.state, { detach: 'ci' }, services()), 'detached');
  assert.deepEqual(
    (await json(file)).webhooks.map((hook) => hook.id),
    ['deploy'],
  );
  assert.equal(await exists(join(f.root, 'config/webhooks/ci.secret')), false);
  assert.equal(await exists(join(f.root, 'config/webhooks/deploy.secret')), true);
  // The last one takes the installation-wide settings with it.
  await configureWebhook(f.root, f.state, { detach: 'deploy' }, services());
  const runtime = await json(join(f.root, 'config/runtime.json'));
  assert.deepEqual(Object.keys(runtime), ['ARKVORY_PORT']);
  assert.equal(await exists(file), false);
  await assert.rejects(
    configureWebhook(f.root, f.state, { detach: 'deploy' }, services()),
    /not a webhook subscription/,
  );
});

test('a rotation keeps both secrets until a call without the next one ends it', async (t) => {
  const f = await installation(t);
  await configureWebhook(
    f.root,
    f.state,
    subscription(f, { nextSecretFile: f.nextFile }),
    services(),
  );
  const directory = join(f.root, 'config/webhooks');
  const [hook] = (await json(join(directory, 'webhooks.json'))).webhooks;
  assert.equal(hook.nextSecretFile, join(directory, 'ci.next-secret'));
  assert.equal((await readFile(join(directory, 'ci.next-secret'), 'utf8')).trim(), other);
  // The receiver is switched; the new secret becomes the main one and the rotation ends.
  await configureWebhook(f.root, f.state, subscription(f, { secretFile: f.nextFile }), services());
  const [done] = (await json(join(directory, 'webhooks.json'))).webhooks;
  assert.equal(done.nextSecretFile, undefined);
  assert.equal((await readFile(join(directory, 'ci.secret'), 'utf8')).trim(), other);
  assert.equal(await exists(join(directory, 'ci.next-secret')), false);
});

test('Compose gets the worker mount and container paths, and loses them with the last subscription', async (t) => {
  const f = await installation(t, 'compose');
  await configureWebhook(f.root, f.state, subscription(f), services());
  const override = await readFile(join(f.root, 'config/compose.webhooks.yml'), 'utf8');
  assert.match(override, /worker:/);
  assert.doesNotMatch(override, /api:/, 'only the worker reads the files');
  assert.match(override, /\.\/config\/webhooks:\/run\/arkvory\/webhooks:ro/);
  assert.equal(
    (await json(join(f.root, 'config/runtime.json'))).ARKVORY_WEBHOOKS_FILE,
    '/run/arkvory/webhooks/webhooks.json',
  );
  const [hook] = (await json(join(f.root, 'config/webhooks/webhooks.json'))).webhooks;
  assert.equal(hook.secretFile, '/run/arkvory/webhooks/ci.secret');
  if (posix) {
    // The directory is 0755 for the bind mount: the secret itself is the container user's alone.
    const secretPath = join(f.root, 'config/webhooks/ci.secret');
    assert.equal(await modeOf(secretPath), 0o600);
    assert.equal((await stat(secretPath)).uid, containerUser);
    assert.equal(await modeOf(join(f.root, 'config/webhooks/webhooks.json')), 0o644);
  }
  await configureWebhook(f.root, f.state, { detach: 'ci' }, services());
  assert.equal(await exists(join(f.root, 'config/compose.webhooks.yml')), false);
});

test('networks and an authority are stored with the subscription and leave with the last one', async (t) => {
  const f = await installation(t);
  const authority = join(f.root, 'receivers.pem');
  await writeFile(authority, selfSignedCertificate().cert);
  await configureWebhook(
    f.root,
    f.state,
    subscription(f, { allowPrivate: '10.20.0.0/16, fd12::/16', caFile: authority }),
    services(),
  );
  const runtime = await json(join(f.root, 'config/runtime.json'));
  assert.equal(runtime.ARKVORY_WEBHOOKS_ALLOW_PRIVATE, '10.20.0.0/16,fd12::/16');
  assert.equal(runtime.ARKVORY_WEBHOOKS_CA_FILE, join(f.root, 'config/webhooks/ca.pem'));
  assert.match(await readFile(join(f.root, 'config/webhooks/ca.pem'), 'utf8'), /BEGIN CERTIFICATE/);
  // Another call without these options keeps them.
  await configureWebhook(f.root, f.state, subscription(f, { id: 'deploy' }), services());
  assert.equal(
    (await json(join(f.root, 'config/runtime.json'))).ARKVORY_WEBHOOKS_ALLOW_PRIVATE,
    '10.20.0.0/16,fd12::/16',
  );
  await configureWebhook(f.root, f.state, { detach: 'ci' }, services());
  await configureWebhook(f.root, f.state, { detach: 'deploy' }, services());
  assert.deepEqual(Object.keys(await json(join(f.root, 'config/runtime.json'))), ['ARKVORY_PORT']);
  assert.equal(await exists(join(f.root, 'config/webhooks/ca.pem')), false);
});

test('invalid input is refused before anything is written or restarted', async (t) => {
  const f = await installation(t);
  const authority = join(f.root, 'expired.pem');
  await writeFile(
    authority,
    selfSignedCertificate({ notBefore: new Date(Date.now() - 10 * 86_400_000), days: 1 }).cert,
  );
  const short = join(f.root, 'short.secret');
  await writeFile(short, 'too-short');
  const cases = [
    [{ id: 'Bad Id' }, /Invalid --webhook/],
    [{ repository: '../x' }, /Invalid --webhook-repository/],
    [{ url: 'http://ci.example.com/hook' }, /--webhook-url/],
    [{ url: 'https://u:p@ci.example.com/hook' }, /--webhook-url/],
    [{ url: 'https://ci.example.com/hook?token=x' }, /--webhook-url/],
    [{ secretFile: 'relative.secret' }, /--webhook-secret-file must be an absolute path/],
    [{ secretFile: short }, /at least 16 printable characters/],
    [{ secretFile: join(f.root, 'missing') }, /ENOENT/],
    [{ nextSecretFile: f.secretFile }, /must differ/],
    [{ actions: [] }, /--webhook-actions/],
    [{ actions: ['Bad Action'] }, /--webhook-actions/],
    [{ allowPrivate: '10.0.0.0' }, /--webhook-allow-private/],
    [{ allowPrivate: '10.0.0.0/33' }, /--webhook-allow-private/],
    [{ caFile: authority }, /expired/],
    [{ caFile: authority }, /--webhook-ca-file/],
  ];
  for (const [extra, message] of cases) {
    const control = services();
    await assert.rejects(
      configureWebhook(f.root, f.state, subscription(f, extra), control),
      message,
      JSON.stringify(extra),
    );
    assert.deepEqual(control.calls, [], 'nothing is restarted');
  }
  assert.deepEqual(await json(join(f.root, 'config/runtime.json')), { ARKVORY_PORT: '8080' });
  assert.equal(await exists(join(f.root, 'config/webhooks/webhooks.json')), false);
  assert.equal(await exists(join(f.root, 'config/webhooks/ci.secret')), false);
});

test('at most 16 subscriptions fit one installation', async (t) => {
  const f = await installation(t);
  for (let index = 0; index < 16; index++)
    await configureWebhook(f.root, f.state, subscription(f, { id: `hook-${index}` }), services());
  await assert.rejects(
    configureWebhook(f.root, f.state, subscription(f, { id: 'one-too-many' }), services()),
    /At most 16/,
  );
  // Replacing an existing one is not a seventeenth.
  await configureWebhook(
    f.root,
    f.state,
    subscription(f, { id: 'hook-3', url: 'https://other.example/h' }),
    services(),
  );
});

test('a service that does not become ready restores the previous configuration and restarts with it', async (t) => {
  const f = await installation(t, 'compose');
  await configureWebhook(f.root, f.state, subscription(f), services());
  const before = {
    runtime: await readFile(join(f.root, 'config/runtime.json'), 'utf8'),
    hooks: await readFile(join(f.root, 'config/webhooks/webhooks.json'), 'utf8'),
    secret: await readFile(join(f.root, 'config/webhooks/ci.secret'), 'utf8'),
  };
  const control = services(1);
  await assert.rejects(
    configureWebhook(
      f.root,
      f.state,
      subscription(f, { url: 'https://ci.example.com/changed', secretFile: f.nextFile }),
      control,
    ),
    /previous configuration is restored \(readiness failed\)/,
  );
  assert.deepEqual(control.calls, ['stop', 'start', 'healthy', 'stop', 'start', 'healthy']);
  assert.equal(await readFile(join(f.root, 'config/runtime.json'), 'utf8'), before.runtime);
  assert.equal(await readFile(join(f.root, 'config/webhooks/webhooks.json'), 'utf8'), before.hooks);
  assert.equal(await readFile(join(f.root, 'config/webhooks/ci.secret'), 'utf8'), before.secret);

  // A first attach that fails leaves no trace at all.
  const clean = await installation(t, 'compose');
  await assert.rejects(
    configureWebhook(clean.root, clean.state, subscription(clean), services(1)),
    /restored/,
  );
  assert.deepEqual(await json(join(clean.root, 'config/runtime.json')), { ARKVORY_PORT: '8080' });
  assert.equal(await exists(join(clean.root, 'config/webhooks/webhooks.json')), false);
  assert.equal(await exists(join(clean.root, 'config/webhooks/ci.secret')), false);
  assert.equal(await exists(join(clean.root, 'config/compose.webhooks.yml')), false);
});

test('the receiver rules match the worker: HTTPS, loopback over HTTP, nothing but a path', () => {
  assert.equal(receiverUrl('https://ci.example.com/hooks/a'), 'https://ci.example.com/hooks/a');
  assert.equal(receiverUrl('http://localhost:9000/hook'), 'http://localhost:9000/hook');
  assert.equal(receiverUrl('http://127.0.0.1:9/h'), 'http://127.0.0.1:9/h');
  for (const bad of [
    'http://ci.example.com/h',
    'ftp://x/h',
    'https://a:b@x/h',
    'https://x/h#f',
    'nope',
    undefined,
  ])
    assert.throws(() => receiverUrl(bad), /--webhook-url/, String(bad));
  assert.equal(allowedNetworks(' 10.0.0.0/8 , ::1/128'), '10.0.0.0/8,::1/128');
});

const posix = process.platform !== 'win32';
const modeOf = async (path) => (await stat(path)).mode & 0o777;

test('Compose secrets belong to the container user alone; systemd keeps root:arkvory 0640', () => {
  const runtime = { uid: 0, gid: 990 };
  assert.deepEqual(webhookFileAccess('systemd', runtime), {
    settings: { mode: 0o640, owner: runtime },
    secret: { mode: 0o640, owner: runtime },
  });
  const compose = webhookFileAccess('compose', runtime);
  assert.deepEqual(compose.secret, {
    mode: 0o600,
    owner: { uid: CONTAINER_USER, gid: CONTAINER_USER },
  });
  assert.equal(CONTAINER_USER, 1000);
  assert.deepEqual(compose.settings, { mode: 0o644, owner: runtime });
});

test('a rollback puts every file back with its previous mode, not a narrower one', async (t) => {
  const f = await installation(t);
  await configureWebhook(f.root, f.state, subscription(f), services());
  const directory = join(f.root, 'config/webhooks');
  const files = ['webhooks.json', 'ci.secret'].map((name) => join(directory, name));
  const before = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  if (posix) for (const file of files) assert.equal(await modeOf(file), 0o640, file);
  await assert.rejects(
    configureWebhook(
      f.root,
      f.state,
      subscription(f, { url: 'https://ci.example.com/changed', secretFile: f.nextFile }),
      services(1),
    ),
    /restored/,
  );
  for (const [index, file] of files.entries()) {
    assert.equal(await readFile(file, 'utf8'), before[index], file);
    // Before the fix a restored file came back 0600 and the arkvory group could not read it.
    if (posix) assert.equal(await modeOf(file), 0o640, file);
  }
});

test('file snapshots restore text and mode, and remove what did not exist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-files-'));
  t.after(() => removeTestDirectory(root));
  const path = join(root, 'settings.json');
  await writeFile(path, 'before');
  await chmod(path, 0o640);
  const snapshot = await snapshotFile(path);
  assert.equal(snapshot.text, 'before');
  await atomicText(path, 'after', 0o600);
  await restoreFile(path, snapshot);
  assert.equal(await readFile(path, 'utf8'), 'before');
  if (posix) assert.equal(await modeOf(path), 0o640);
  const absent = join(root, 'new.secret');
  const none = await snapshotFile(absent);
  assert.equal(none, null);
  await atomicText(absent, 'secret', 0o600);
  await restoreFile(absent, none);
  assert.equal(await exists(absent), false);
});

test('a failed atomic write leaves no temporary file that could hold a secret', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-files-'));
  t.after(() => removeTestDirectory(root));
  // A directory in place of the target makes the final rename fail after the secret was written.
  const target = join(root, 'ci.secret');
  await mkdir(target);
  await writeFile(join(target, 'keep'), '');
  await assert.rejects(atomicText(target, 'a-long-random-signing-secret-1', 0o600));
  assert.deepEqual(await readdir(root), ['ci.secret']);
});

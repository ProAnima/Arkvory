import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../../apps/api/dist/index.js';
import { setup, base } from './fixture.mjs';
import {
  publish,
  record,
  runBackup,
  scratch,
  sha,
  sourceEnv,
  temporaryDatabase,
} from './backup-fixture.mjs';

const MARKER = Buffer.from('E2E-ENCRYPTED-MARKER-7c2f');
const NAME = 'alice-secret-account-name';

async function files(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** An encrypted vault made by the real CLI: the vault, the agent key and the kit. */
async function encryptedVault(t, env = {}) {
  const vault = await scratch(t, 'vault', 'vault');
  const keyFile = await scratch(t, 'keys', 'agent.key');
  const kitFile = await scratch(t, 'kit', 'recovery-kit.txt');
  const made = await runBackup(
    ['vault', 'init', vault, '--kit-file', kitFile, '--agent-key-file', keyFile],
    env,
  );
  assert.equal(made.code, 0, made.stdout + made.stderr);
  assert.equal(record(made, 'backup.vault.initialized').encrypted, true);
  return { vault, keyFile, kitFile, made };
}

test('an encrypted vault is created, captured, verified and restored through the operator CLI', async (t) => {
  const f = await setup(t);
  const user = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: NAME, password: 'long-private-password' },
  });
  assert.equal(user.statusCode, 201, user.body);
  const published = [
    await publish(f, Buffer.concat([MARKER, Buffer.alloc(40_000, 7)])),
    await publish(f, Buffer.alloc(0)),
    await publish(f, Buffer.concat([MARKER, Buffer.from(' second')])),
  ];
  const env = sourceEnv(f);
  const { vault, keyFile, kitFile, made } = await encryptedVault(t, env);
  // Neither key appears in the output of the command that made them.
  const key = (await readFile(keyFile, 'utf8')).trim();
  const kit = await readFile(kitFile, 'utf8');
  assert.match(key, /^AK1(-[A-Z2-7]{4}){14}$/);
  assert.match(kit, /Recovery key:\s+RK1(-[A-Z2-7]{4}){14}/);
  assert.equal(made.stdout.includes(key) || made.stderr.includes(key), false);
  const kitKey = /RK1(-[A-Z2-7]{4}){14}/.exec(kit)[0];
  assert.equal(made.stdout.includes(kitKey), false);
  assert.equal(
    JSON.parse(await readFile(join(vault, 'vault.json'), 'utf8')).encryption,
    'aes-256-gcm-v1',
  );

  const captured = await runBackup(
    ['capture', '--vault', vault, '--key-file', keyFile, '--idempotency-key', 'n-1'],
    env,
  );
  assert.equal(captured.code, 0, captured.stdout + captured.stderr);
  const done = record(captured, 'backup.capture.completed');
  assert.equal(done.outcome, 'created');
  assert.equal(done.blobs, published.length);
  const replay = await runBackup(
    ['capture', '--vault', vault, '--key-file', keyFile, '--idempotency-key', 'n-1'],
    env,
  );
  assert.equal(record(replay, 'backup.capture.completed').outcome, 'existing');

  // Nothing of the catalog or the content is on the disk of the vault in the clear.
  for (const file of await files(vault)) {
    const bytes = await readFile(file);
    assert.equal(bytes.includes(MARKER), false, `content in ${file}`);
    assert.equal(bytes.includes(NAME), false, `catalog in ${file}`);
  }

  // The service key and the recovery kit both read the vault; the environment names a key as well.
  const listed = await runBackup(['list', '--vault', vault, '--key-file', kitFile]);
  assert.deepEqual(
    listed.records.filter((r) => r.code === 'backup.point').map((r) => r.pointId),
    [done.pointId],
  );
  const viaEnv = await runBackup(['list', '--vault', vault], {
    ARKVORY_BACKUP_VAULT_KEY_FILE: keyFile,
  });
  assert.equal(viaEnv.code, 0, viaEnv.stdout + viaEnv.stderr);
  for (const depth of [[], ['--deep']]) {
    const verified = await runBackup(['verify', '--vault', vault, '--key-file', kitFile, ...depth]);
    assert.equal(verified.code, 0, verified.stdout);
    assert.equal(record(verified, 'backup.verify.point').outcome, 'verified');
  }

  // A new server restores from the vault with the recovery kit alone.
  const database = await temporaryDatabase(t);
  const storage = await scratch(t, 'restore', 'storage');
  const restore = [
    'restore',
    '--vault',
    vault,
    '--key-file',
    kitFile,
    '--point',
    done.pointId,
    '--storage',
    storage,
  ];
  const target = { ARKVORY_RESTORE_DATABASE_URL: database.url };
  const restored = await runBackup([...restore, '--yes'], target);
  assert.equal(restored.code, 0, restored.stdout + restored.stderr);
  assert.equal(record(restored, 'backup.restore.completed').outcome, 'restored');
  const app = await createServer({
    ...f.config,
    databaseUrl: database.url,
    dataDirectory: storage,
  });
  database.release(() => app.close());
  for (const item of published) {
    const content = await app.inject({
      url: `${base}/artifacts/${item.id}/content`,
      headers: f.headers,
    });
    assert.equal(content.statusCode, 200);
    assert.equal(sha(content.rawPayload), sha(item.bytes));
  }
  // The catalog came back with the account that was only ever stored in the encrypted tables.
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { name: NAME, password: 'long-private-password' },
  });
  assert.equal(login.statusCode, 200, login.body);
});

test('a missing, wrong or damaged key stops every command with its own code and exit status', async (t) => {
  const f = await setup(t);
  await publish(f, Buffer.concat([MARKER, Buffer.alloc(1000)]));
  const env = sourceEnv(f);
  const first = await encryptedVault(t, env);
  const other = await encryptedVault(t, env);
  const garbage = await scratch(t, 'keys', 'garbage.key');
  await writeFile(garbage, 'this is not a key\n');
  const typo = await scratch(t, 'keys', 'typo.key');
  const text = (await readFile(first.keyFile, 'utf8')).trim();
  await writeFile(typo, text.slice(0, -1) + (text.endsWith('A') ? 'B' : 'A') + '\n');
  const attempts = [
    ['capture', '--vault', first.vault],
    ['list', '--vault', first.vault],
    ['verify', '--vault', first.vault, '--deep'],
    [
      'restore',
      '--vault',
      first.vault,
      '--point',
      '00000000-0000-4000-8000-000000000001',
      '--storage',
      await scratch(t, 'restore', 'storage'),
    ],
  ];
  for (const args of attempts) {
    const without = await runBackup(args, {
      ...env,
      ARKVORY_RESTORE_DATABASE_URL: env.ARKVORY_DATABASE_URL,
    });
    assert.equal(without.code, 3, args[0]);
    assert.equal(record(without, 'backup.failed').errorCode, 'vault_key_missing', args[0]);
    assert.match(without.stderr, /--key-file|ARKVORY_BACKUP_VAULT_KEY_FILE/);
  }
  for (const [file, code] of [
    [other.keyFile, 'vault_key_invalid'],
    [garbage, 'vault_key_invalid'],
    [typo, 'vault_key_invalid'],
    [join(first.vault, '..', 'absent.key'), 'vault_key_missing'],
  ]) {
    const refused = await runBackup(['list', '--vault', first.vault, '--key-file', file]);
    assert.equal(refused.code, 3);
    assert.equal(record(refused, 'backup.failed').errorCode, code, file);
  }
  // Nothing was written to the vault by the refused capture.
  assert.deepEqual(await readdir(join(first.vault, 'points')), ['.staging']);
  assert.deepEqual(await readdir(join(first.vault, 'blobs')), []);
});

test('key slots are listed, added, rotated and removed without ever printing a key', async (t) => {
  const f = await setup(t);
  await publish(f);
  const env = sourceEnv(f);
  const { vault, keyFile, kitFile } = await encryptedVault(t, env);
  const captured = await runBackup(['capture', '--vault', vault, '--key-file', keyFile], env);
  assert.equal(captured.code, 0, captured.stdout + captured.stderr);

  const slots = async (extra = []) =>
    (await runBackup(['vault', 'key', 'list', '--vault', vault, ...extra])).records.filter(
      (r) => r.code === 'backup.vault.key',
    );
  const initial = await slots();
  assert.deepEqual(initial.map((slot) => slot.keyKind).sort(), ['agent', 'recovery']);
  assert.ok(initial.every((slot) => /^[0-9a-f]{16}$/.test(slot.slotId)));
  const verified = await runBackup([
    'vault',
    'key',
    'verify',
    '--vault',
    vault,
    '--key-file',
    kitFile,
  ]);
  assert.equal(verified.code, 0, verified.stdout + verified.stderr);
  assert.equal(record(verified, 'backup.vault.key.verify').keyKind, 'recovery');

  // A second kit (for another safe) and a rotated agent key.
  const secondKit = await scratch(t, 'kit', 'second-kit.txt');
  const added = await runBackup([
    'vault',
    'key',
    'add-recovery',
    '--vault',
    vault,
    '--key-file',
    keyFile,
    '--kit-file',
    secondKit,
  ]);
  assert.equal(added.code, 0, added.stdout + added.stderr);
  const newKey = await scratch(t, 'keys', 'rotated.key');
  const rotated = await runBackup([
    'vault',
    'key',
    'rotate-agent',
    '--vault',
    vault,
    '--key-file',
    kitFile,
    '--agent-key-file',
    newKey,
  ]);
  assert.equal(rotated.code, 0, rotated.stdout + rotated.stderr);
  // The previous agent slot stays until the new key is installed: the old key still opens.
  const previous = record(rotated, 'backup.vault.key.previous');
  assert.match(previous.slotId, /^[0-9a-f]{16}$/);
  const stillOpens = await runBackup(['list', '--vault', vault, '--key-file', keyFile]);
  assert.equal(stillOpens.code, 0, stillOpens.stdout + stillOpens.stderr);
  const removed = await runBackup([
    'vault',
    'key',
    'remove',
    '--vault',
    vault,
    '--key-file',
    kitFile,
    '--slot',
    previous.slotId,
  ]);
  assert.equal(removed.code, 0, removed.stdout + removed.stderr);
  for (const secret of [
    await readFile(newKey, 'utf8'),
    await readFile(secondKit, 'utf8'),
    await readFile(keyFile, 'utf8'),
  ])
    for (const line of secret.match(/(?:AK1|RK1)(?:-[A-Z2-7]{4}){14}/g) ?? [])
      for (const output of [added, rotated, verified])
        assert.equal(output.stdout.includes(line) || output.stderr.includes(line), false);
  // The old agent key no longer opens the vault; the new one and both kits do.
  const old = await runBackup(['list', '--vault', vault, '--key-file', keyFile]);
  assert.equal(record(old, 'backup.failed').errorCode, 'vault_key_invalid');
  for (const file of [newKey, kitFile, secondKit]) {
    const opened = await runBackup(['list', '--vault', vault, '--key-file', file]);
    assert.equal(opened.code, 0, `${file}: ${opened.stdout}`);
  }
  assert.equal((await runBackup(['capture', '--vault', vault, '--key-file', newKey], env)).code, 0);

  // A kit that cannot be written, or already exists, changes nothing in the vault.
  const before = await slots();
  const exists = await runBackup([
    'vault',
    'key',
    'add-recovery',
    '--vault',
    vault,
    '--key-file',
    newKey,
    '--kit-file',
    secondKit,
  ]);
  assert.equal(exists.code, 2);
  assert.deepEqual(
    (await slots()).map((slot) => slot.slotId),
    before.map((slot) => slot.slotId),
  );
  // The last recovery slot stays; a removed slot leaves its key useless.
  const recovery = before.filter((slot) => slot.keyKind === 'recovery');
  const [first, second] = recovery;
  const dropOne = await runBackup([
    'vault',
    'key',
    'remove',
    '--vault',
    vault,
    '--key-file',
    newKey,
    '--slot',
    first.slotId,
  ]);
  assert.equal(dropOne.code, 0, dropOne.stdout + dropOne.stderr);
  const dropLast = await runBackup([
    'vault',
    'key',
    'remove',
    '--vault',
    vault,
    '--key-file',
    newKey,
    '--slot',
    second.slotId,
  ]);
  assert.equal(dropLast.code, 2);
  assert.equal((await slots()).filter((slot) => slot.keyKind === 'recovery').length, 1);
});

test('a plain vault stays plain, ignores keys, and its key commands say so', async (t) => {
  const f = await setup(t);
  await publish(f, Buffer.concat([MARKER, Buffer.alloc(100)]));
  const env = sourceEnv(f);
  const vault = await scratch(t, 'vault', 'vault');
  const made = await runBackup(['vault', 'init', vault, '--no-encryption'], env);
  assert.equal(made.code, 0, made.stdout + made.stderr);
  assert.equal(record(made, 'backup.vault.initialized').encrypted, false);
  assert.equal((await runBackup(['capture', '--vault', vault], env)).code, 0);
  const found = [];
  for (const file of await files(vault))
    if ((await readFile(file)).includes(MARKER)) found.push(file);
  assert.ok(found.length >= 1, 'a plain vault holds plain content: the scan above can see it');
  const key = await runBackup(['vault', 'key', 'list', '--vault', vault]);
  assert.equal(key.code, 2);
  // An argument without an explicit choice creates nothing.
  const unchosen = await scratch(t, 'vault', 'unchosen');
  const refused = await runBackup(['vault', 'init', unchosen], env);
  assert.equal(refused.code, 2);
  await assert.rejects(stat(unchosen), { code: 'ENOENT' });
});

test('a vault that cannot get its key files is not left behind', async (t) => {
  const vault = await scratch(t, 'vault', 'vault');
  const taken = await scratch(t, 'kit', 'taken.txt');
  await writeFile(taken, 'already here');
  const agentKey = await scratch(t, 'keys', 'agent.key');
  const refused = await runBackup([
    'vault',
    'init',
    vault,
    '--kit-file',
    taken,
    '--agent-key-file',
    agentKey,
  ]);
  assert.equal(refused.code, 2, refused.stdout + refused.stderr);
  await assert.rejects(stat(agentKey), { code: 'ENOENT' }, 'no key file without a vault');
  assert.deepEqual(await readdir(vault).catch(() => []), [], 'the vault directory holds nothing');
  assert.equal(await readFile(taken, 'utf8'), 'already here', 'the existing file is untouched');
  // The kit may not lie inside the vault: the keys would be lost or copied together with it.
  const inside = await runBackup([
    'vault',
    'init',
    vault,
    '--kit-file',
    join(vault, 'kit.txt'),
    '--agent-key-file',
    agentKey,
  ]);
  assert.equal(inside.code, 3);
  assert.equal(record(inside, 'backup.failed').errorCode, 'unsafe_path');
});

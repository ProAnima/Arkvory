import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { configureBackup } from '../apps/deploy/dist/backup-setup.js';
import { BackupCredentialRejected, waitForBackup } from '../apps/deploy/dist/backup-probe.js';
import {
  hiddenBySystemdSandbox,
  inspectVault,
  vaultContents,
} from '../apps/deploy/dist/vault-location.js';
import { removeTestDirectory } from './helpers.mjs';

const release = { version: '1.2.3', commit: 'c', schema: 26, archiveSha256: 'a', setupSha256: 's' };
const wait = { attempts: 3, intervalMs: 1 };

async function directory(t, prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(path));
  return path;
}

async function installation(t) {
  const root = await directory(t, 'arkvory-backup-setup-');
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'data'));
  const runtime = { ARKVORY_PORT: '8080', ARKVORY_DATA_DIR: join(root, 'data') };
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify(runtime, null, 2) + '\n');
  return root;
}

async function vaultDocument(path, vaultId = randomUUID()) {
  const document = { format: 'arkvory-vault', version: 1, vaultId, encryption: 'none' };
  await writeFile(join(path, 'vault.json'), JSON.stringify({ ...document, createdAt: 'now' }));
  return vaultId;
}

const status = ({ online = true, configured = false, available = false, id = null } = {}) => ({
  agent: { online, lastSeenAt: null, version: null },
  vault: { configured, available, id, freeBytes: null, totalBytes: null },
});

/** Fake service control; `reply` maps the calls so far to the agent's reported status. */
function services(reply) {
  const calls = [];
  return {
    calls,
    adopt: async (current) => calls.push(`adopt ${current.version}`),
    openVault: async (vault) => {
      calls.push(vault === null ? 'open none' : 'open vault');
      return async () => calls.push('undo');
    },
    initializeVault: async (vault) => {
      calls.push('init');
      await vaultDocument(vault);
    },
    readVault: (vault) => vaultContents(vault),
    restartBackup: async () => calls.push('restart'),
    backupStatus: async () => reply(calls),
  };
}

const runtimeOf = async (root) =>
  JSON.parse(await readFile(join(root, 'config/runtime.json'), 'utf8'));
const vaultFile = (vault) => readFile(join(vault, 'vault.json'), 'utf8');
const state = (mode) => ({ mode, current: release });

test('an existing vault is used as is and confirmed by its own ID in the agent heartbeat', async (t) => {
  const root = await installation(t);
  const vault = await directory(t, 'arkvory-vault-');
  const vaultId = await vaultDocument(vault);
  let reports = 0;
  // A stale heartbeat of the previous agent (no vault) must not count as success.
  const control = services(() =>
    ++reports < 2 ? status() : status({ configured: true, available: true, id: vaultId }),
  );
  const outcome = await configureBackup(
    root,
    state('windows'),
    { vault, initialize: true },
    control,
    { wait },
  );
  assert.deepEqual(outcome, { vaultId, initialized: false });
  assert.deepEqual(control.calls, ['adopt 1.2.3', 'open vault', 'restart']);
  const runtime = await runtimeOf(root);
  assert.equal(runtime.ARKVORY_BACKUP_VAULT, await realpath(vault));
  assert.equal(runtime.ARKVORY_DATA_DIR, join(root, 'data'), 'other settings are preserved');
});

test('--init-vault creates vault.json only in an empty directory and grants the result', async (t) => {
  const root = await installation(t);
  const vault = await directory(t, 'arkvory-vault-');
  const control = services(async () =>
    status({ configured: true, available: true, id: JSON.parse(await vaultFile(vault)).vaultId }),
  );
  const outcome = await configureBackup(
    root,
    state('compose'),
    { vault, initialize: true },
    control,
    { wait },
  );
  assert.equal(outcome.initialized, true);
  assert.deepEqual(control.calls, ['adopt 1.2.3', 'open vault', 'init', 'open vault', 'restart']);
  assert.equal((await runtimeOf(root)).ARKVORY_BACKUP_VAULT, '/srv/arkvory-vault');
});

test('a directory without vault.json is refused before anything changes', async (t) => {
  const root = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  const vault = await directory(t, 'arkvory-vault-');
  const control = services(() => status());
  await assert.rejects(
    configureBackup(root, state('windows'), { vault }, control, { wait }),
    /no vault\.json.*--init-vault/,
  );
  await writeFile(join(vault, 'unrelated.txt'), 'x');
  await assert.rejects(
    configureBackup(root, state('windows'), { vault, initialize: true }, control, { wait }),
    /needs an empty directory/,
  );
  assert.deepEqual(control.calls, []);
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
});

test('invalid, missing and overlapping vault locations are refused', async (t) => {
  const root = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  const control = services(() => status());
  const configure = (vault) =>
    configureBackup(root, state('windows'), { vault, initialize: true }, control, { wait });
  await assert.rejects(configure('relative/vault'), /absolute path/);
  await assert.rejects(configure(join(root, 'missing')), /does not exist/);
  await writeFile(join(root, 'file'), 'x');
  await assert.rejects(configure(join(root, 'file')), /must be a directory|outside/);
  const inside = join(root, 'vault');
  await mkdir(inside);
  await assert.rejects(configure(inside), /outside the installation root/);
  await assert.rejects(configure(join(root, 'data')), /outside the installation root/);
  await assert.rejects(configure(parse(root).root), /filesystem root/);
  await assert.rejects(configure(tmpdir()), /must not contain them/);
  // A link elsewhere that resolves into the installation is the same location.
  const links = await directory(t, 'arkvory-links-');
  const link = join(links, 'vault');
  await symlink(inside, link, 'junction');
  try {
    await assert.rejects(configure(link), /outside the installation root/);
  } finally {
    // Before the root goes: Windows cannot remove a tree with a dangling junction.
    await unlink(link);
  }
  const quoted = await directory(t, "arkvory-vault-'quoted'-");
  await assert.rejects(configure(quoted), /characters/);
  assert.deepEqual(control.calls, []);
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
  await assert.rejects(
    configureBackup(root, state('windows'), { vault: inside, disable: true }, control),
    /either --backup-vault/,
  );
  await assert.rejects(configureBackup(root, state('windows'), {}, control), /Specify/);
});

test('the storage directory counts as the installation even when configured elsewhere', async (t) => {
  const root = await installation(t);
  const storage = await directory(t, 'arkvory-storage-');
  const runtime = { ...(await runtimeOf(root)), ARKVORY_DATA_DIR: storage };
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify(runtime));
  const nested = join(storage, 'vault');
  await mkdir(nested);
  await assert.rejects(
    configureBackup(root, state('windows'), { vault: nested }, services(status), { wait }),
    /storage directory/,
  );
  // Compose keeps storage in a volume: only the installation root is a host tree there.
  await vaultDocument(nested);
  const id = JSON.parse(await vaultFile(nested)).vaultId;
  await configureBackup(
    root,
    state('compose'),
    { vault: nested },
    services(() => status({ configured: true, available: true, id })),
    { wait },
  );
});

test('a vault the agent never reports restores runtime.json and the previous exposure', async (t) => {
  const root = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  const vault = await directory(t, 'arkvory-vault-');
  await vaultDocument(vault);
  const control = services(() =>
    status({ configured: true, available: true, id: '00000000-0000-4000-8000-000000000000' }),
  );
  await assert.rejects(
    configureBackup(root, state('windows'), { vault }, control, { wait }),
    /not configured; the previous configuration is restored \(The backup agent did not report this vault/,
  );
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
  assert.deepEqual(control.calls, ['adopt 1.2.3', 'open vault', 'restart', 'undo', 'restart']);
});

test('the rollback returns once the agent reports the previous state, else says so', async (t) => {
  const root = await installation(t);
  const vault = await directory(t, 'arkvory-vault-');
  await vaultDocument(vault);
  // The refused vault stays in the heartbeat until the restarted agent reports none again.
  const restarts = (calls) => calls.filter((call) => call === 'restart').length;
  const recovering = services((calls) =>
    restarts(calls) < 2 ? status({ configured: true, available: false }) : status(),
  );
  const refused = await configureBackup(root, state('windows'), { vault }, recovering, {
    wait,
  }).catch((error) => error);
  assert.match(refused.message, /previous configuration is restored/);
  assert.doesNotMatch(refused.message, /rollback incomplete/);
  // An agent that keeps the refused vault's report: the command does not claim a clean state.
  const stuck = services(() => status({ configured: true, available: false }));
  await assert.rejects(
    configureBackup(root, state('windows'), { vault }, stuck, { wait }),
    /rollback incomplete: the backup agent did not report the previous configuration/,
  );
});

test('a failure before the restart rolls back without restarting the agent', async (t) => {
  const root = await installation(t);
  const vault = await directory(t, 'arkvory-vault-');
  const control = services(() => status());
  control.initializeVault = async () => {
    control.calls.push('init');
    throw new Error('vault init failed (3)');
  };
  await assert.rejects(
    configureBackup(root, state('windows'), { vault, initialize: true }, control, { wait }),
    /previous configuration is restored \(vault init failed \(3\)\)/,
  );
  assert.deepEqual(control.calls, ['adopt 1.2.3', 'open vault', 'init', 'undo']);
  assert.equal((await runtimeOf(root)).ARKVORY_BACKUP_VAULT, undefined);
});

test('turning the vault off requires the agent online without a vault', async (t) => {
  const root = await installation(t);
  const runtime = { ...(await runtimeOf(root)), ARKVORY_BACKUP_VAULT: '/mnt/backup/arkvory' };
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify(runtime));
  let reports = 0;
  const control = services(() =>
    ++reports < 2 ? status({ configured: true, available: true }) : status({ configured: false }),
  );
  const outcome = await configureBackup(root, state('systemd'), { disable: true }, control, {
    wait,
  });
  assert.deepEqual(outcome, { vaultId: null, initialized: false });
  assert.deepEqual(control.calls, ['adopt 1.2.3', 'open none', 'restart']);
  assert.equal((await runtimeOf(root)).ARKVORY_BACKUP_VAULT, undefined);
});

test('a rejected bootstrap credential ends the wait immediately', async () => {
  let probes = 0;
  await assert.rejects(
    waitForBackup(
      async () => {
        probes++;
        throw new BackupCredentialRejected();
      },
      () => true,
      { attempts: 5, intervalMs: 1 },
    ),
    BackupCredentialRejected,
  );
  assert.equal(probes, 1);
  // Other failures (API restarting) are retried until the bound.
  let failures = 0;
  const result = await waitForBackup(
    async () => {
      failures++;
      throw new Error('connect ECONNREFUSED');
    },
    () => true,
    { attempts: 3, intervalMs: 1 },
  );
  assert.equal(result, null);
  assert.equal(failures, 3);
});

test('the systemd sandbox of the agent hides home, root and private temporary trees', () => {
  for (const path of ['/home/ops/vault', '/root/vault', '/tmp/vault', '/var/tmp', '/run/user/0'])
    assert.equal(hiddenBySystemdSandbox(path), true, path);
  for (const path of ['/mnt/backup/arkvory', '/srv/vault', '/homes/vault', '/var/backups'])
    assert.equal(hiddenBySystemdSandbox(path), false, path);
});

test('inspection reports the canonical path, vault identity and emptiness', async (t) => {
  const root = await installation(t);
  const vault = await directory(t, 'arkvory-vault-');
  const context = {
    root,
    dataDirectory: join(root, 'data'),
    mode: 'windows',
    platform: process.platform,
  };
  assert.deepEqual(await inspectVault(vault, context), {
    path: await realpath(vault),
    vaultId: null,
    empty: true,
  });
  const vaultId = await vaultDocument(vault);
  assert.equal((await inspectVault(vault, context)).vaultId, vaultId);
  await writeFile(join(vault, 'vault.json'), '{"format":"other"}');
  await assert.rejects(inspectVault(vault, context), /not an Arkvory vault/);
});

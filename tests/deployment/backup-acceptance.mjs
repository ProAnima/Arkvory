import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ArkvoryClient } from '../../packages/sdk/dist/index.js';

const base = 'http://127.0.0.1:8080';

/** Polls GET /api/v1/backup/status; the failure names the last agent and vault state. */
export async function waitForAgent(token, accept, purpose, attempts = 60) {
  const client = new ArkvoryClient(base, () => token);
  let last = 'no answer';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const status = await client.backup.status(AbortSignal.timeout(5000));
      if (accept(status)) return status;
      last = JSON.stringify({ agent: status.agent, vault: status.vault });
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(2000);
  }
  throw Error(`${purpose}: ${last}`);
}

export const vaultReported = (status) =>
  status.agent.online &&
  status.vault.configured &&
  status.vault.available &&
  status.vault.id !== null;

/**
 * The installed agent end to end (ADR 0057): online without a vault after installation,
 * `configure --backup-vault … --init-vault` through the given callback, then one capture of a
 * published blob through POST /api/v1/backup/runs. Returns the point to check in the vault.
 */
export async function exerciseBackupAgent(token, configure) {
  const client = new ArkvoryClient(base, () => token);
  const initial = await waitForAgent(
    token,
    (status) => status.agent.online,
    'The installed backup agent must come online',
  );
  assert.equal(initial.vault.configured, false);
  assert.ok(initial.warnings.some((warning) => warning.code === 'vault_not_configured'));
  await configure();
  const configured = await client.backup.status();
  assert.ok(vaultReported(configured), JSON.stringify(configured.vault));
  // A published blob, so the capture reads content through the agent's own storage view.
  const bytes = randomBytes(64 * 1024);
  const descriptor = {
    name: 'backup-acceptance.bin',
    size: String(bytes.length),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    labels: [],
    metadata: {},
  };
  const upload = await client.create('releases', randomUUID(), descriptor);
  await client.resume('releases', upload.id, new Blob([bytes]));
  const receipt = await client.backup.run(randomUUID());
  for (let attempt = 0; attempt < 90; attempt++) {
    const job = (await client.backup.jobs({ limit: 20 })).items.find(
      (item) => item.id === receipt.id,
    );
    if (job?.state === 'failed') throw Error(`Backup capture failed: ${job.errorCode}`);
    if (job?.state === 'completed' && job.pointId) {
      const point = (await client.backup.points({ limit: 10 })).items.find(
        (item) => item.id === job.pointId,
      );
      assert.ok(point && point.blobs >= 1, 'The point must contain the published blob');
      console.log('Installed backup agent: vault configured, capture completed');
      return { vaultId: configured.vault.id, pointId: job.pointId };
    }
    await delay(2000);
  }
  throw Error('The backup capture did not complete within three minutes');
}

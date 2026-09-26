import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function exerciseUpdateControl(token, tick) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = 'http://127.0.0.1:8080/api/v1/system/updates';
  const status = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  assert.equal(status.status, 200);
  const before = await status.json();
  assert.ok(before.snapshot, 'Installer must connect the host updater');
  const id = randomUUID();
  const queued = await fetch(url + '/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      kind: 'configure',
      expectedRevision: before.snapshot.revision,
      automatic: false,
      hourUTC: 22,
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(queued.status, 202, await queued.text());
  await tick();
  for (let attempt = 0; attempt < 45; attempt++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    if (result.snapshot.lastRequestId === id) {
      assert.equal(result.snapshot.error, null);
      assert.equal(result.snapshot.hourUTC, 22);
      assert.equal(result.snapshot.automatic, false);
      console.log('Unprivileged API mailbox and privileged host updater round-trip passed');
      return;
    }
    await delay(1000);
  }
  throw Error('Host updater did not acknowledge the queued configuration');
}

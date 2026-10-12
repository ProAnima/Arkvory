import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';

const peer = (name, connected, complete, witness = false) => ({
  name,
  connected,
  disk: witness ? 'Diskless' : complete ? 'UpToDate' : 'DUnknown',
  complete,
  witness,
});
const healthy = {
  copies: 2,
  required: 2,
  singleCopyUntil: null,
  node: 'node-a',
  profile: 'ha-2',
  peers: [peer('node-b', true, true), peer('witness', true, false, true)],
};
const degraded = {
  ...healthy,
  copies: 1,
  peers: [peer('node-b', false, false), peer('witness', true, false, true)],
};

/**
 * An HA installation (ADR 0072) with a stand-in for the arkvory-replica helper. Administrators
 * get the Cluster page with every node and the next step; when a copy is lost, a banner leads
 * there. Other people get only a notice that uploads pause. Runs last: it restarts the server.
 */
export async function exerciseCluster(browser, f) {
  let answer = healthy;
  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\arkvory-browser-replica-${randomUUID()}`
      : join(tmpdir(), `arkvory-browser-replica-${randomUUID()}.sock`);
  const helper = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer));
  });
  helper.listen(socket);
  await once(helper, 'listening');
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    f.config.replicaSocket = socket;
    await f.restart();
    const origin = await f.listen();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/console/`);
    await chooseLanguage(page, 'en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#cluster-nav').waitFor();
    await page.locator('[data-nav=cluster]').click();
    const panel = page.locator('#cluster-panel');
    await page.locator('#cluster-peers tr').nth(1).waitFor();
    const text = await panel.innerText();
    for (const expected of [
      'Two data nodes and a witness',
      'node-a',
      '2 of 2 required',
      'Accepted',
      'Witness (votes, holds no data)',
    ])
      assert.ok(text.includes(expected), expected);
    assert.equal(
      await page.locator('#cluster-command').innerText(),
      'arkvory cluster-switchover --to node-b',
    );
    assert.equal(await page.locator('#replication-banner').isVisible(), false);

    // The peer is lost: the banner names it and leads to the page with the next step.
    answer = degraded;
    // From another screen: on the Cluster page itself the banner offers no way to it.
    await page.locator('[data-nav=catalog]').click();
    await page.reload();
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#replication-banner').waitFor();
    assert.match(
      await page.locator('#replication-notice').innerText(),
      /1 of 2 copies are complete/,
    );
    await page.locator('#replication-open').click();
    await page.locator('#cluster-writes[data-state=off]').waitFor();
    assert.equal(await page.locator('#replication-open').isVisible(), false);
    assert.match(
      await page.locator('#cluster-command').innerText(),
      /^arkvory cluster-single-copy --root \/opt\/proanima-arkvory --until \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z --reason "<why>"$/,
    );
    assert.equal(await page.locator('#cluster-replace').isVisible(), true);
    assert.equal(
      await page.locator('#cluster-peers tr').first().locator('td').nth(3).innerText(),
      'Missing',
    );
    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `cluster at 320px: ${String(overflow)}px wider`);
    await chooseLanguage(page, 'ru');
    assert.match(await panel.innerText(), /Запись\s+Остановлена/);

    // Someone without administration sees why uploads pause, but no cluster details.
    const reader = await context.newPage();
    reader.on('pageerror', (error) => errors.push(error.message));
    await reader.goto(`${origin}/console/`);
    await chooseLanguage(reader, 'en');
    await connectWithKey(reader, f.readerHeaders.authorization.slice(7));
    await reader.locator('#replication-banner').waitFor();
    assert.match(
      await reader.locator('#replication-notice').innerText(),
      /Uploads are paused while the server restores a copy/,
    );
    assert.equal(await reader.locator('#replication-open').isVisible(), false);
    assert.equal(await reader.locator('#cluster-nav').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      'PASS cluster: nodes, copies, writes and the next step for administrators; banner to the page on a lost copy; readers see only the notice; 320px; RU/EN',
    );
  } finally {
    await context.close();
    await new Promise((resolve) => helper.close(resolve));
  }
}

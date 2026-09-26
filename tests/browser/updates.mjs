// Real HTTP/DB/UI acceptance. The privileged updater is represented by its durable mailbox snapshot.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { setup } from '../integration/fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';
import { initialUpdateSnapshot } from '../../apps/deploy/dist/update-monitor.js';

const directory = await mkdtemp(join(tmpdir(), 'depot-update-browser-'));
const cleanup = [];
let browser;
try {
  await mkdir(join(directory, 'status'));
  await mkdir(join(directory, 'inbox'));
  const snapshot = initialUpdateSnapshot(
    { automatic: false, pin: null, current: { version: '1.0.0', schema: 15 } },
    new Date().toISOString(),
  );
  snapshot.checkedAt = snapshot.heartbeatAt;
  snapshot.latest = { version: '1.1.0', schema: 15, sha256: 'a'.repeat(64) };
  const save = () => writeFile(join(directory, 'status/snapshot.json'), JSON.stringify(snapshot));
  await save();
  const f = await setup({ after: (fn) => cleanup.push(fn) }, { updateControlDirectory: directory });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DEPOT_BROWSER_CHANNEL ? { channel: process.env.DEPOT_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = await f.listen();
  const connect = async () => {
    await page.goto(base + '/console/');
    await page.locator('#language').selectOption('en');
    await page.locator('#token').fill(f.headers.authorization.slice(7));
    await page.locator('#connect button.primary').click();
    await page.locator('#update-banner').waitFor();
    await page.locator('#update-banner button').click();
    await page.locator('#updates-panel').waitFor();
  };
  await connect();
  assert.match(await page.locator('#update-notice').innerText(), /1.1.0/);
  assert.equal(await page.locator('#update-install').isEnabled(), true);
  await mkdir('test-results', { recursive: true });
  for (const width of [1440, 390])
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#theme').selectOption(theme);
      await page.locator('#language').selectOption(width === 390 ? 'ru' : 'en');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.screenshot({ path: `test-results/updates-${width}-${theme}.png`, fullPage: true });
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#language').selectOption('en');
  snapshot.revision++;
  await save();
  await page.locator('#update-check').click();
  await page.waitForFunction(
    () => document.querySelector('#updates-status').dataset.i18n === 'updateConflict',
  );
  await assert.rejects(readFile(join(directory, 'inbox/request.json')), { code: 'ENOENT' });
  await page.locator('#update-install').click();
  await page.locator('#update-confirm').waitFor();
  assert.match(await page.locator('#update-confirm-title').innerText(), /1.1.0/);
  await page.locator('#update-cancel').click();
  await assert.rejects(readFile(join(directory, 'inbox/request.json')), { code: 'ENOENT' });
  await page.locator('#update-install').click();
  await page.locator('#update-proceed').click();
  await page.waitForFunction(
    () => document.querySelector('#updates-status').dataset.i18n === 'updatePending',
  );
  const request = JSON.parse(await readFile(join(directory, 'inbox/request.json'), 'utf8'));
  assert.equal(request.kind, 'apply');
  assert.equal(request.sha256, snapshot.latest.sha256);
  assert.equal(await page.locator('#update-install').isDisabled(), true);
  await unlink(join(directory, 'inbox/request.json'));
  snapshot.revision++;
  snapshot.lastRequestId = request.id;
  snapshot.phase = 'failed';
  snapshot.error = 'maintenance_required';
  snapshot.latest.schema = 16;
  await save();
  await connect();
  assert.equal(await page.locator('#update-install').isDisabled(), true);
  assert.match(await page.locator('#updates-status').innerText(), /database schema/);
  await page.locator('#update-automatic').check();
  await page.locator('#update-hour').selectOption('22');
  await page.locator('#update-settings button').click();
  await page.waitForFunction(
    () => document.querySelector('#updates-status').dataset.i18n === 'updatePending',
  );
  const policy = JSON.parse(await readFile(join(directory, 'inbox/request.json'), 'utf8'));
  assert.equal(policy.kind, 'configure');
  assert.equal(policy.automatic, true);
  assert.equal(policy.hourUTC, 22);
  await page.locator('#connection-card > summary').click();
  await page.locator('#logout').click();
  assert.equal(await page.locator('#updates-nav').isVisible(), false);
  assert.equal(await page.locator('#update-banner').isVisible(), false);
  await page.locator('#token').fill(f.readerHeaders.authorization.slice(7));
  await page.locator('#connect button.primary').click();
  await page.waitForFunction(
    () => document.querySelector('#connection-state').dataset.connected === 'true',
  );
  assert.equal(await page.locator('#updates-nav').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'Update notifications, confirmation, queued settings, permissions and responsive themes passed',
  );
} finally {
  await browser?.close();
  for (const fn of cleanup.reverse()) await fn();
  await removeTestDirectory(directory);
}

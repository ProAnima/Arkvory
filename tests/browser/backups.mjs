// Backups screen against the real API, database, backup agent and a temporary vault (ADR 0056).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { connectWithKey, jargon } from './session.mjs';
import { capture, newVault } from '../integration/backup-fixture.mjs';
import {
  api,
  eventually,
  requests,
  savePlan,
  startAgent,
} from '../integration/backup-agent-fixture.mjs';

const isStatus = (request) => request.url().includes('/api/v1/backup/status');
const two = (value) => String(value).padStart(2, '0');

/**
 * Retention keeps one point per local day of the plan zone. A fixed zone made the expected
 * keep/delete split depend on the wall clock near local midnight; a zone where it is now about
 * noon keeps every point of this short scenario on one local day whenever the gate runs.
 */
function middayZone(now = new Date()) {
  let best = 0;
  for (let offset = -11; offset <= 12; offset++) {
    const hour = (now.getUTCHours() + offset + 24) % 24;
    const current = (now.getUTCHours() + best + 24) % 24;
    if (Math.abs(hour - 12) < Math.abs(current - 12)) best = offset;
  }
  // POSIX-style Etc zones invert the sign: Etc/GMT-3 is UTC+03:00.
  return best === 0 ? 'UTC' : `Etc/GMT${best > 0 ? '-' : '+'}${String(Math.abs(best))}`;
}

async function warningCodes(page) {
  return page
    .locator('#backup-warnings li')
    .evaluateAll((items) => items.map((item) => item.dataset.code));
}

/** No agent has run yet: critical state, warnings with operator actions, empty tables. */
async function initialState(page) {
  await page.locator('#backup-state:not([data-state=unknown])').waitFor();
  assert.equal(await page.locator('#backup-state').getAttribute('data-state'), 'critical');
  assert.deepEqual(await warningCodes(page), [
    'vault_not_configured',
    'agent_offline',
    'schedule_disabled',
    'no_backup_yet',
  ]);
  assert.equal(await page.locator('#backup-warnings li .help-trigger').count(), 4);
  const offline = page.locator('#backup-warnings li[data-code=agent_offline]');
  assert.equal(await offline.locator('.backup-severity').innerText(), 'Critical');
  await offline.locator('.help-trigger').focus();
  assert.match(await offline.locator('[role=tooltip]').innerText(), /arkvory-backup/);
  await page.keyboard.press('Escape');
  const missing = page.locator('#backup-warnings li[data-code=vault_not_configured]');
  assert.match(await missing.locator('[role=tooltip]').textContent(), /ARKVORY_BACKUP_VAULT/);
  assert.equal(await page.locator('#backup-agent').innerText(), 'Offline');
  assert.equal(await page.locator('#backup-agent-seen').innerText(), 'Has not connected yet');
  assert.equal(await page.locator('#backup-vault').innerText(), 'Not configured');
  assert.equal(await page.locator('#backup-newest').innerText(), 'No backups yet');
  assert.equal(await page.locator('#backup-next').innerText(), 'Schedule is off');
  assert.equal(await page.locator('#backup-points-empty').isVisible(), true);
  assert.equal(await page.locator('#backup-jobs-empty').isVisible(), true);
  assert.match(await page.locator('.backup-restore').innerText(), /operator action/);
  assert.equal(await page.locator('#backups-panel button', { hasText: /restore/i }).count(), 0);
}

/** Save with CAS, a conflicting save elsewhere, and a field rejected by the server. */
async function planForm(page, f) {
  // Twelve hours away: the daily slot cannot fall due while the scenario runs.
  const hour = (new Date().getUTCHours() + 15) % 24;
  await page.locator('#backup-enabled').check();
  await page.locator('#backup-time').fill(`${two(hour)}:30`);
  // The browser zone (Asia/Tokyo in this context) is offered, never applied silently.
  assert.equal(await page.locator('#backup-timezone').inputValue(), 'UTC');
  await page.locator('#backup-zone-browser').click();
  assert.equal(await page.locator('#backup-timezone').inputValue(), 'Asia/Tokyo');
  assert.equal(await page.locator('#backup-zone-offset').innerText(), 'Now UTC+09:00');
  assert.equal(await page.locator('#backup-zone-browser').isVisible(), false);
  await page.locator('#backup-timezone').fill('Europe/Moscow');
  assert.equal(await page.locator('#backup-zone-offset').innerText(), 'Now UTC+03:00');
  await page.locator('#backup-plan-save').click();
  await page.locator('#backup-plan-status[data-i18n=backupPlanSaved]').waitFor();
  const saved = (await api(f, 'GET', '/plan')).body;
  assert.deepEqual(
    [saved.enabled, saved.hour, saved.minute, saved.timezone, saved.revision],
    [true, hour, 30, 'Europe/Moscow', 2],
  );
  await page.waitForFunction(
    () => !document.querySelector('#backup-warnings li[data-code=schedule_disabled]'),
  );
  assert.match(await page.locator('#backup-next-utc').innerText(), /UTC/);
  // Another administrator saves meanwhile: this form must not overwrite that version.
  await savePlan(f, { minute: 15 });
  await page.locator('#backup-daily').fill('9');
  await page.locator('#backup-plan-save').click();
  await page.locator('#backup-plan-status[data-i18n=backupPlanConflict]').waitFor();
  assert.equal(await page.locator('#backup-time').inputValue(), `${two(hour)}:15`);
  assert.equal(await page.locator('#backup-daily').inputValue(), '7');
  assert.equal((await api(f, 'GET', '/plan')).body.retention.daily, 7);
  // The server validates zone names; its details mark the field (ADR 0051).
  await page.locator('#backup-timezone').fill('Mars/Base');
  assert.equal(
    await page.locator('#backup-zone-offset').getAttribute('data-i18n'),
    'backupZoneUnknown',
  );
  await page.locator('#backup-plan-save').click();
  await page.locator('#backup-timezone[aria-invalid=true]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'backup-timezone');
  assert.equal(await page.locator('#backup-plan-status').getAttribute('data-i18n'), 'errorFields');
  await page.locator('#language').selectOption('ru');
  assert.equal(await page.locator('#backup-timezone-error').innerText(), 'Неверный формат.');
  await page.locator('#language').selectOption('en');
  await page.locator('#backup-timezone').fill('Europe/Moscow');
  assert.equal(await page.locator('#backup-timezone').getAttribute('aria-invalid'), null);
  assert.equal((await api(f, 'GET', '/plan')).body.timezone, 'Europe/Moscow');
  return hour;
}

/**
 * Run-now queues a job that nobody runs yet: the page polls while it waits, stops on another
 * screen and in a hidden tab, and resumes when the tab is visible again.
 */
async function queuedRun(page, f) {
  let calls = 0;
  page.on('request', (request) => {
    if (isStatus(request)) calls++;
  });
  await page.locator('#backup-run').click();
  await page.locator('#backup-status[data-i18n=backupRunQueued]').waitFor();
  await page.locator('#backup-jobs .backup-job-state[data-state=queued]').waitFor();
  assert.equal(await page.locator('#backup-run').isDisabled(), true);
  assert.deepEqual(
    (await requests(f)).map((row) => [row.kind, row.state]),
    [['capture', 'queued']],
  );
  await page.waitForRequest(isStatus, { timeout: 8000 });
  await page.locator('nav [data-nav=catalog]').click();
  let before = calls;
  await page.waitForTimeout(6000);
  assert.equal(calls, before, 'no polling on another screen');
  await Promise.all([
    page.waitForRequest(isStatus),
    page.locator('nav [data-nav=backups]').click(),
  ]);
  await page.locator('#backup-summary:not([aria-busy])').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  before = calls;
  await page.waitForTimeout(6000);
  assert.equal(calls, before, 'no polling in a hidden tab');
  await Promise.all([
    page.waitForRequest(isStatus, { timeout: 2000 }),
    page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }),
  ]);
}

/** An agent without ARKVORY_BACKUP_VAULT is online but fails the queued job (vault_missing). */
async function agentWithoutVault(page, f) {
  const agent = startAgent(f, undefined);
  try {
    await page.locator('#backup-jobs .backup-job-state[data-state=failed]').waitFor({
      timeout: 30000,
    });
    assert.match(await page.locator('#backup-jobs tr').first().innerText(), /vault_missing/);
    await page.locator('#backup-agent[data-i18n=backupAgentOnline]').waitFor();
    const codes = await warningCodes(page);
    assert.ok(codes.includes('vault_not_configured'), codes.join());
    assert.ok(!codes.includes('agent_offline'), codes.join());
    assert.ok(codes.includes('last_run_failed'), codes.join());
    assert.equal(await page.locator('#backup-vault').innerText(), 'Not configured');
    assert.equal(await page.locator('#backup-run').isEnabled(), true);
  } finally {
    await agent.stop();
  }
}

const pointRow = (page, id) =>
  page.locator('#backup-points tr', { has: page.locator(`[id="backup-point-${id}-time"]`) });

/** CLI point pinned in the console, then a capture by run-now; the pin keeps the CLI point. */
async function captures(page, f, vault) {
  const first = await capture(f, vault, 'ui-cli-1');
  let agent = startAgent(f, vault);
  try {
    await eventually(() => agent.has('backup.catalog.reconciled'), 'catalog rebuild');
    await page.locator('#backup-refresh').click();
    const row = pointRow(page, first.pointId);
    await row.waitFor();
    await row.getByRole('button', { name: 'Pin', exact: true }).click();
    await row.locator('.badge', { hasText: 'Pinned' }).waitFor();
    assert.equal((await api(f, 'GET', '/points')).body.items[0].pinned, true);
    await page.locator('#backup-run').click();
    await page.locator('#backup-status[data-i18n=backupRunQueued]').waitFor();
    // Focus on a row button survives polling and the reload of points.
    await row.getByRole('button', { name: 'Unpin', exact: true }).focus();
    await page.locator('#backup-points tr').nth(1).waitFor({ timeout: 30000 });
    const second = (await api(f, 'GET', '/points')).body.items[0];
    assert.notEqual(second.id, first.pointId);
    await pointRow(page, second.id)
      .locator('.backup-chip[data-verify=structural]')
      .waitFor({ timeout: 30000 });
    // Only free space depends on the machine running the scenario.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#backup-warnings li')].every(
          (item) => item.dataset.code === 'vault_low_space',
        ),
      undefined,
      { timeout: 30000 },
    );
    assert.notEqual(await page.locator('#backup-state').getAttribute('data-state'), 'critical');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Unpin');
    assert.equal(await page.locator('#backup-run').isEnabled(), true);
    assert.equal(await page.locator('#backup-vault').getAttribute('data-i18n'), 'backupVaultFree');
    assert.match(await page.locator('#backup-newest').innerText(), /ago|now/);
    assert.ok(await page.locator('#backup-newest').getAttribute('title'));
    await agent.stop();
    // Another CLI point appears once a restarted agent rebuilds the catalog from the vault.
    const third = await capture(f, vault, 'ui-cli-3');
    agent = startAgent(f, vault);
    await eventually(() => agent.has('backup.catalog.reconciled'), 'second rebuild');
    await page.locator('#backup-refresh').click();
    await pointRow(page, third.pointId).waitFor();
    return { agent, pinned: first.pointId, older: second.id, newest: third.pointId };
  } catch (error) {
    await agent.stop();
    throw error;
  }
}

/** Preview in the shared confirmation dialog; cancel queues nothing, confirm removes. */
async function retention(page, f, points) {
  const retentionRequests = async () => (await requests(f, "kind='retention'")).length;
  const queued = await retentionRequests();
  await page.locator('#backup-retention').click();
  const dialog = page.locator('#action-confirm');
  await dialog.waitFor();
  const lists = dialog.locator('.backup-retention-preview section');
  assert.match(await lists.nth(0).locator('h3').innerText(), /Removed: 1/);
  assert.match(await lists.nth(1).locator('h3').innerText(), /Kept: 2/);
  const kept = await lists.nth(1).locator('li').allInnerTexts();
  assert.ok(
    kept.some((text) => /newest/.test(text) && /day/.test(text)),
    kept.join('|'),
  );
  assert.ok(
    kept.some((text) => /pinned/.test(text)),
    kept.join('|'),
  );
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'action-confirm-cancel');
  await page.locator('#action-confirm-cancel').click();
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await retentionRequests(), queued);
  await page.locator('#backup-retention').click();
  await page.locator('#action-confirm-proceed').click();
  await page.locator('#backup-points-status[data-i18n=backupRetentionQueued]').waitFor();
  await page.waitForFunction(
    (id) => !document.getElementById(`backup-point-${id}-time`),
    points.older,
    { timeout: 30000 },
  );
  assert.deepEqual(
    (await api(f, 'GET', '/points')).body.items.map((point) => point.id),
    [points.newest, points.pinned],
  );
  const newest = pointRow(page, points.newest);
  await newest.getByRole('button', { name: 'Verify fully' }).click();
  await page.locator('#backup-points-status[data-i18n=backupVerifyQueued]').waitFor();
  await newest.locator('.backup-chip[data-verify=deep]').waitFor({ timeout: 30000 });
}

async function layouts(page, paths) {
  await mkdir('test-results', { recursive: true });
  for (const width of [320, 390, 768, 1024, 1440])
    for (const theme of ['light', 'dark'])
      for (const language of ['ru', 'en']) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#theme').selectOption(theme);
        await page.locator('#language').selectOption(language);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 0, `backups overflow ${overflow}px at ${width}/${theme}/${language}`);
        const text = await page.locator('#backups-panel').innerText();
        for (const path of paths) assert.ok(!text.includes(path), 'no filesystem path is shown');
        if (width === 1440 && theme === 'light') assert.doesNotMatch(text, jargon, language);
        if ((width === 390 && language === 'ru') || (width === 1440 && language === 'en'))
          await page.screenshot({
            path: `test-results/backups-${width}-${theme}.png`,
            fullPage: true,
          });
      }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#theme').selectOption('light');
  await page.locator('#language').selectOption('en');
}

/** Touch input enlarges every control of the screen to 44 px; the mouse layout stays dense. */
async function touchTargets(browser, origin, f) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/console/#/backups`);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#backup-points tr').first().waitFor();
    for (const selector of [
      '#backup-refresh',
      '#backup-run',
      '#backup-retention',
      '#backup-points tr button >> nth=0',
      '#backup-points tr button >> nth=1',
      '#backup-plan-save',
      '#backups-panel .help-trigger >> nth=0',
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.height >= 44 && box.width >= 44, `${selector} ${box?.height}px`);
    }
  } finally {
    await context.close();
  }
}

/** A key without backup permissions sees neither the section nor its deep link. */
async function readerKey(context, origin, f) {
  const page = await context.newPage();
  await page.goto(`${origin}/console/#/backups`);
  await page.locator('#language').selectOption('en');
  await connectWithKey(page, f.readerHeaders.authorization.slice(7));
  await page.locator('#status[data-i18n=routeUnavailable]').waitFor();
  assert.equal(await page.locator('#backups-nav').isVisible(), false);
  assert.equal(await page.locator('#backups-panel').isVisible(), false);
  await page.close();
}

export async function exerciseBackups(browser, origin, f) {
  const cleanup = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Tokyo',
  });
  let agent;
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // A link opened before sign-in waits until backup permissions are discovered.
    await page.goto(`${origin}/console/#/backups`);
    await page.locator('#language').selectOption('en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#backups-panel').waitFor();
    await initialState(page);
    await planForm(page, f);
    await queuedRun(page, f);
    await agentWithoutVault(page, f);
    const { path: vault } = await newVault({ after: (fn) => cleanup.push(fn) });
    await savePlan(f, { timezone: middayZone() });
    const points = await captures(page, f, vault);
    agent = points.agent;
    await retention(page, f, points);
    await agent.stop();
    agent = undefined;
    await page.locator('#backup-refresh').click();
    await page.locator('#backup-agent[data-i18n=backupAgentOffline]').waitFor();
    await layouts(page, [vault, f.directory, tmpdir()]);
    await touchTargets(browser, origin, f);
    await readerKey(context, origin, f);
    assert.deepEqual(errors, []);
    console.log(
      'PASS backups: status/warnings, plan CAS + field error, run-now polling, vault-less agent, pin, retention dialog, deep verify, 44px touch, reader hidden, 5 widths × RU/EN × light/dark',
    );
  } finally {
    await agent?.stop();
    await context.close();
    for (const fn of cleanup.reverse()) await fn();
  }
}

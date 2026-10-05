import { fillKey } from './session.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { create, base } from '../integration/fixture.mjs';
import { chooseLanguage } from './language.mjs';

// A stage set elsewhere appears in the catalog row before the labels; removed afterwards so later
// scenarios do not meet a retention blocker.
async function exerciseCatalogStages(page, f, id) {
  const stage = (method) =>
    f.app.inject({
      method,
      url: `${base}/artifacts/${id}/stages/smoke`,
      headers: f.headers,
    });
  const added = await stage('PUT');
  assert.ok(added.statusCode < 300, added.body);
  await page.locator('[data-nav=catalog]').click();
  await page.locator('#search').evaluate((form) => {
    form.requestSubmit();
  });
  const row = page.locator('#artifacts tr').filter({ hasText: id });
  await row.locator('.artifact-stage', { hasText: 'smoke' }).waitFor();
  assert.deepEqual(await row.locator('.artifact-tags .badge').allTextContents(), [
    'smoke',
    'linux',
    'release',
  ]);
  const removed = await stage('DELETE');
  assert.ok(removed.statusCode < 300, removed.body);
}

// Real API/database: stages, history, promotion to a second repository and RU/EN layout.
export async function exercisePromotion(page, f) {
  f.config.keys[0].principal.repositories = ['releases', 'prod'];
  const bytes = Buffer.from('UI promotion acceptance');
  const id = (await create(f, bytes)).json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseLanguage(page, 'en');
  await fillKey(page, f.headers.authorization.slice(7));
  await page.locator('[data-nav=catalog]').click();
  await page.locator('#connect-submit').click();
  const row = page.locator('#artifacts tr').filter({ hasText: id });
  await row.waitFor();
  // Search rows carry size, publication time and current labels without opening the artifact.
  assert.match(await row.locator('.artifact-facts').textContent(), /23\s*B/);
  assert.equal(await row.locator('.artifact-facts time').count(), 1);
  assert.deepEqual(await row.locator('.artifact-tags .badge').allTextContents(), [
    'linux',
    'release',
  ]);
  assert.equal(await row.locator('.artifact-stage').count(), 0);
  await row.locator('button').first().click();
  await page.locator('#promotion-panel').waitFor();
  await page.locator('#artifact-summary').waitFor();
  assert.equal(
    await page.locator('#summary-sha').textContent(),
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.match(await page.locator('#summary-size').textContent(), /23\s*B/);
  // Invalid names are rejected client-side with a localized hint.
  await page.locator('#stage-name').fill('QA');
  await page.locator('#stage-form button').click();
  await page.locator('#status[data-tone=error]').waitFor();
  await page.locator('#stage-name').fill('qa');
  await page.locator('#stage-comment').fill('smoke passed');
  await page.locator('#stage-form button').click();
  await page.locator('#stage-list li', { hasText: 'qa' }).waitFor();
  await page.locator('#promotion-history li', { hasText: 'added stage qa' }).waitFor();
  await page.locator('#promote-form').waitFor();
  assert.deepEqual(await page.locator('#promote-target option').allTextContents(), ['prod']);
  // The move checkbox sits before its label on the same row in both languages.
  assert.equal(
    await page.evaluate(() => {
      const box = document.getElementById('promote-move').getBoundingClientRect();
      const text = document.querySelector('#promote-move + span').getBoundingClientRect();
      return (
        box.right <= text.left &&
        Math.abs(box.top + box.height / 2 - (text.top + text.height / 2)) < 16
      );
    }),
    true,
  );
  await page.locator('#promote-stages').fill('release, canary');
  await page.locator('#promote-comment').fill('ui release');
  await page.locator('#promote-form button.primary').click();
  await page.locator('#promotion-status', { hasText: 'Published in prod' }).waitFor();
  const staged = await f.app.inject({
    url: '/api/v1/repositories/prod/stages?stage=release',
    headers: f.headers,
  });
  assert.equal(staged.json().items.length, 1);
  await page.locator('#promotion-history li', { hasText: 'copied to prod' }).waitFor();
  // Removal asks for confirmation (accepted by the scenario dialog handler).
  await page.locator('#stage-list li', { hasText: 'qa' }).locator('button').click();
  await page.locator('#stage-empty').waitFor();
  await chooseLanguage(page, 'ru');
  assert.equal(await page.locator('#promotion-title').textContent(), 'Продвижение');
  assert.match(await page.locator('#summary-size').textContent(), /23\s*Б/);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `promotion panel overflows at ${String(width)}px`,
    );
  }
  await chooseLanguage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await exerciseCatalogStages(page, f, id);
  await page.locator('#connection-card summary').first().click();
  await page.locator('#logout').click();
  await page.waitForFunction(() => document.querySelector('#token').value === '');
  f.config.keys[0].principal.repositories = ['releases'];
  console.log(
    'PASS promotion UI: catalog row size/date/labels/stages, summary, stage add/validate/remove, promote to another repository, history, RU/EN and narrow widths',
  );
}

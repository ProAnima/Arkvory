import { exerciseAdminConfirmations, exerciseSignIn, fillKey, jargon } from './session.mjs';
import { exerciseStoragePolicy } from './storage-policy.mjs';
import { exerciseGuides } from './guides.mjs';
import { exerciseAppearance } from './appearance.mjs';
import {
  exerciseCatalogUsability,
  exerciseAdministrationLoading,
  exerciseClearedMessages,
} from './usability.mjs';
// Browser gate against real API/database. Only the OS save picker is substituted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setup, create, base } from '../integration/fixture.mjs';
import { exerciseBuildDetails } from './build-details.mjs';
import { exerciseDeletion } from './deletion.mjs';
import { exercisePromotion } from './promotion.mjs';
import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ARKVORY_BROWSER_CHANNEL ? { channel: process.env.ARKVORY_BROWSER_CHANNEL } : {}),
});
const cleanup = [];
try {
  const f = await setup({
    after(fn) {
      cleanup.push(fn);
    },
  });
  const bytes = Buffer.from('Arkvory UI acceptance');
  const id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${id}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('ui-download', { create: true });
  });
  const go = async (view) => {
    const nav = page.locator(`[data-nav=${view}]`);
    if (!(await nav.isVisible())) await page.locator('#navigation-toggle').click();
    await nav.click();
    assert.equal(await page.locator(`#${view}-panel`).isVisible(), true);
    assert.equal(
      await page.locator('#page-title').evaluate((n) => n === document.activeElement),
      true,
    );
  };
  const origin = await f.listen();
  await page.goto(`${origin}/console/`);
  await page.locator('#language').selectOption('en');
  await exerciseAppearance(page);
  assert.equal(await page.locator('#login-name').isVisible(), true);
  assert.equal(await page.locator('#token').isVisible(), false);
  assert.equal(await page.locator('#logout').isVisible(), false);
  await fillKey(page, f.headers.authorization.slice(7));
  await page.locator('#connect-submit').click();
  await page.locator('#artifacts tr').waitFor();
  assert.equal(await page.locator('#connection-card').getAttribute('open'), null);
  await page.locator('#query').fill('not-present');
  await page.locator('#search button').first().click();
  await page.locator('#catalog-empty').waitFor();
  assert.equal(await page.locator('#empty-title').getAttribute('data-i18n'), 'noResultsTitle');
  await page.locator('#search-clear').click();
  await page.locator('#artifacts tr').waitFor();
  await exerciseCatalogUsability(page, go);
  // Direct download does not require opening the metadata editor.
  await page.locator('#artifacts button').nth(1).click();
  await page.getByRole('cell', { name: 'Verified and saved', exact: true }).waitFor();
  await page.locator('#downloads-clear-finished').click();
  await page.locator('#download-empty').waitFor();
  await page.locator('#downloads-pause').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'downloads-resume');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'downloads-pause');
  assert.equal(await page.locator('#downloads-cancel').isDisabled(), true);
  assert.equal(await page.locator('#download-policy').isVisible(), false);
  await page.locator('.queue-settings summary').click();
  await page.locator('#download-concurrency').fill('3');
  await page.locator('#download-policy button').click();
  await page.locator('#download-status[data-tone=success]').waitFor();
  await page.locator('.queue-settings summary').click();
  await go('catalog');
  await page.locator('#artifacts button').first().click();
  await page.locator('#selected-name').waitFor();
  assert.equal(await page.locator('#selected-name').textContent(), 'artifact.upack');
  assert.equal(await page.locator('#artifact-deletion').isVisible(), false);
  await page.locator('#metadata-advanced summary').click();
  await page.locator('#metadata').fill('{invalid');
  await page.locator('#edit button.primary').click();
  await page.locator('#status[data-tone=error]').waitFor();
  await page.locator('#metadata').fill('{"release":"candidate"}');
  await page.locator('#labels').fill('reviewed, stable');
  await page.locator('#edit button.primary').click();
  await page.locator('#status[data-tone=success]').waitFor();
  await go('catalog');
  await page.locator('#query').fill('CANDIDATE');
  await page.locator('#search button').first().click();
  await page.waitForFunction(
    () =>
      document.querySelector('#artifacts').rows.length === 1 &&
      !document.querySelector('#catalog-panel').hasAttribute('aria-busy'),
  );
  await page
    .locator('#filter-metadata-key')
    .evaluate((node) => (node.closest('details').open = true));
  await page.locator('#filter-metadata-key').fill('release');
  await page.locator('#filter-metadata-value').fill('missing');
  await page.locator('#search button').first().click();
  await page.waitForFunction(
    () =>
      document.querySelector('#artifacts').rows.length === 0 &&
      !document.querySelector('#catalog-panel').hasAttribute('aria-busy'),
  );
  await page.locator('#search-clear').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#artifacts').rows.length > 0 &&
      !document.querySelector('#catalog-panel').hasAttribute('aria-busy'),
  );
  assert.equal(await page.locator('#filter-metadata-key').inputValue(), '');
  assert.equal(await page.locator('#filter-metadata-value').inputValue(), '');
  await go('metadata');
  await exerciseBuildDetails(page, f, id);
  await page.locator('#asset-path').fill('releases/latest.upack');
  await page.locator('#asset button').click();
  await page.waitForFunction(() => document.querySelector('#asset-revision').value === '1');
  await go('history');
  await page.locator('#history-path').fill('releases/latest.upack');
  await page.locator('#history button').click();
  await page.locator('#asset-history tr').waitFor();
  await exerciseAdministrationLoading(page, go);
  await page.locator('summary[data-i18n=createUser]').click();
  await page.locator('#new-user-name').fill('ui-reviewer');
  await page.locator('#new-user-password').fill('acceptance-fixture-password');
  await page.locator('#create-user button').click();
  await page.getByRole('cell', { name: 'ui-reviewer', exact: true }).waitFor();
  assert.equal(await page.locator('#new-user-password').inputValue(), '');
  await page.locator('summary[data-i18n=createUser]').click();
  await exerciseAdminConfirmations(page);
  await go('upload');
  await page.locator('#file').setInputFiles({
    name: 'ui-upload.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded through console'),
  });
  // Delay the real request, without mocking its response, to inspect the in-flight UI.
  let releaseUpload;
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  let finishInterception;
  const interceptionFinished = new Promise((resolve) => {
    finishInterception = resolve;
  });
  await page.route('**/uploads/*/parts/0', async (route) => {
    await uploadGate;
    await route.abort('aborted');
    finishInterception();
  });
  await Promise.all([
    page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().endsWith('/parts/0'),
    ),
    page.locator('#upload-submit').click(),
  ]);
  assert.equal(await page.locator('#login-name').isDisabled(), true);
  assert.equal(await page.locator('#login button[data-i18n=signIn]').isDisabled(), true);
  assert.equal(await page.locator('#cancel').isEnabled(), true);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
    'Active upload protects against accidentally leaving the page',
  );
  const pausedUpload = await page.locator('#upload-id').inputValue();
  await page.locator('#cancel').click();
  await page.locator('#transfer-status[data-i18n=paused][data-tone=info]').waitFor();
  assert.equal(await page.locator('#upload-id').inputValue(), pausedUpload);
  assert.notEqual(pausedUpload, '');
  releaseUpload();
  await interceptionFinished;
  await page.unroute('**/uploads/*/parts/0');
  await page.locator('#upload-submit').click();
  await page.locator('#transfer-status[data-tone=success]').waitFor();
  // Publication succeeds before the catalog refresh releases the connection controls.
  await page.waitForFunction(() => !document.querySelector('#login-name').disabled);
  assert.equal(await page.locator('#login-name').isEnabled(), true);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
    'Completed transfers do not trap navigation',
  );
  // Appearance changes and navigation must preserve unsaved form fields.
  await go('metadata');
  await page.locator('#labels').fill('unsaved-label');
  await mkdir('test-results', { recursive: true });
  for (const width of [320, 390, 768, 1440])
    for (const theme of ['light', 'dark'])
      for (const language of ['ru', 'en']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#theme').selectOption(theme);
        await page.locator('#language').selectOption(language);
        for (const view of [
          'catalog',
          'upload',
          'downloads',
          'packages',
          'history',
          'metadata',
          'administration',
        ]) {
          await go(view);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          if (overflow) {
            await page.screenshot({ path: 'test-results/console-overflow.png', fullPage: true });
            console.log(
              await page.evaluate(() =>
                [...document.querySelectorAll('body *')]
                  .filter((node) => node.getBoundingClientRect().right > innerWidth)
                  .slice(0, 16)
                  .map((node) => ({
                    tag: node.tagName,
                    id: node.id,
                    className: node.getAttribute('class'),
                    right: node.getBoundingClientRect().right,
                  })),
              ),
            );
          }
          assert.equal(overflow, false, `${width}/${theme}/${language}/${view}`);
          if (width === 1440 && theme === 'light')
            assert.doesNotMatch(
              await page.locator('main').innerText(),
              jargon,
              `${language}/${view}`,
            );
          if (width !== 768 && language === (width === 390 ? 'ru' : 'en'))
            await page.screenshot({
              path: `test-results/console-${view}-${width}-${theme}.png`,
              fullPage: true,
            });
        }
      }
  assert.equal(await page.locator('#labels').inputValue(), 'unsaved-label');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#navigation-toggle').click();
  await page.locator('[data-nav=catalog]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.locator('#navigation-toggle').evaluate((n) => n === document.activeElement),
    true,
  );
  // Disconnect clears private views, while preferences remain usable.
  await page.locator('#connection-card summary').first().click();
  await page.locator('#logout').click();
  await page.waitForFunction(() => document.querySelector('#token').value === '');
  assert.equal(await page.locator('#selected-name').isVisible(), false);
  await exerciseClearedMessages(page);
  assert.equal(await page.locator('#logout').isVisible(), false);
  await exerciseSignIn(browser, origin, f, id);
  await exercisePromotion(page, f);
  await exerciseDeletion(page, f);
  await exerciseStoragePolicy(page, f);
  await exerciseGuides(page, f);
  assert.deepEqual(errors, []);
  console.log(
    'PASS console: API upload/download, metadata, history, users, search/reset, keyboard menu, 7 views × 4 widths × RU/EN × light/dark',
  );
} finally {
  await browser.close();
  for (const close of cleanup.reverse()) await close();
}

import { exerciseStoragePolicy } from './storage-policy.mjs';
// Optional acceptance against a real API/database. Only the OS save picker is substituted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setup, create, base } from '../integration/fixture.mjs';
import { exerciseBuildDetails } from './build-details.mjs';
import { exerciseDeletion } from './deletion.mjs';
const { chromium } = await import(
  process.env.DEPOT_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.DEPOT_PLAYWRIGHT_MODULE).href
    : 'playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DEPOT_BROWSER_CHANNEL ? { channel: process.env.DEPOT_BROWSER_CHANNEL } : {}),
});
const cleanup = [];
try {
  const f = await setup({
    after(fn) {
      cleanup.push(fn);
    },
  });
  const bytes = Buffer.from('Depot UI acceptance');
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
  await page.goto(`${await f.listen()}/console/`);
  await page.locator('#language').selectOption('en');
  assert.equal(await page.locator('#login-name').isVisible(), false);
  await page.locator('#password-login summary').click();
  assert.equal(await page.locator('#login-name').isVisible(), true);
  await page.locator('#password-login summary').click();
  await page.locator('#token').fill(f.headers.authorization.slice(7));
  await page.locator('#connect button.primary').click();
  await page.locator('#artifacts tr').waitFor();
  assert.equal(await page.locator('#connection-card').getAttribute('open'), null);
  await page.locator('#query').fill('not-present');
  await page.locator('#search button').first().click();
  await page.locator('#catalog-empty').waitFor();
  assert.equal(await page.locator('#empty-title').getAttribute('data-i18n'), 'noResultsTitle');
  await page.locator('#search-clear').click();
  await page.locator('#artifacts tr').waitFor();
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
  await exerciseBuildDetails(page, f, id);
  await page.locator('#asset-path').fill('releases/latest.upack');
  await page.locator('#asset button').click();
  await page.waitForFunction(() => document.querySelector('#asset-revision').value === '1');
  await go('history');
  await page.locator('#history-path').fill('releases/latest.upack');
  await page.locator('#history button').click();
  await page.locator('#asset-history tr').waitFor();
  await go('administration');
  await page.locator('summary[data-i18n=createUser]').click();
  await page.locator('#new-user-name').fill('ui-reviewer');
  await page.locator('#new-user-password').fill('acceptance-fixture-password');
  await page.locator('#create-user button').click();
  await page.getByRole('cell', { name: 'ui-reviewer', exact: true }).waitFor();
  assert.equal(await page.locator('#new-user-password').inputValue(), '');
  await page.locator('summary[data-i18n=createUser]').click();
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
  await page.route('**/uploads/*/parts/0', async (route) => {
    await uploadGate;
    await route.continue();
  });
  await Promise.all([
    page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().endsWith('/parts/0'),
    ),
    page.locator('#upload-submit').click(),
  ]);
  assert.equal(await page.locator('#login-name').isDisabled(), true);
  assert.equal(await page.locator('#login button').isDisabled(), true);
  assert.equal(await page.locator('#cancel').isEnabled(), true);
  releaseUpload();
  await page.locator('#transfer-status[data-tone=success]').waitFor();
  await page.unroute('**/uploads/*/parts/0');
  assert.equal(await page.locator('#login-name').isEnabled(), true);
  // Appearance changes and navigation must preserve unsaved form fields.
  await go('metadata');
  await page.locator('#labels').fill('unsaved-label');
  await mkdir('test-results', { recursive: true });
  for (const width of [390, 768, 1440])
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
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `${width}/${theme}/${language}/${view}`,
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
  await exerciseDeletion(page, f);
  await exerciseStoragePolicy(page, f);
  assert.deepEqual(errors, []);
  console.log(
    'PASS console: API upload/download, metadata, history, users, search/reset, keyboard menu, 7 views × 3 widths × RU/EN × light/dark',
  );
} finally {
  await browser.close();
  for (const close of cleanup.reverse()) await close();
}

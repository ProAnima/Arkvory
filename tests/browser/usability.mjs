import assert from 'node:assert/strict';

const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

export async function exerciseCatalogUsability(page, go) {
  const credential = await page.locator('#token').inputValue();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await go('upload');
  await page.locator('#file').setInputFiles({
    name: 'retained-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('draft'),
  });
  await page.locator('.brand').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#catalog-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  assert.equal(await page.locator('#token').inputValue(), credential);
  assert.equal(await page.locator('#file').evaluate((n) => n.files[0]?.name), 'retained-draft.txt');
  assert.equal(
    await page.locator('#page-title').evaluate((n) => n === document.activeElement),
    true,
  );
  await page.locator('#file').setInputFiles([]);

  await page.evaluate(() => {
    const picker = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => {
      window.showSaveFilePicker = picker;
      throw new DOMException('User cancelled', 'AbortError');
    };
  });
  await page.locator('#artifacts button').nth(1).click();
  await settle(page);
  assert.equal(await page.locator('#global-feedback').isVisible(), false);
  assert.equal(await page.locator('#download-rows tr').count(), 0);
  assert.equal(await page.locator('#catalog-panel').isVisible(), true);

  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const stale = '**/search?q=stale-request&label=';
  await page.route(stale, async (route) => {
    await delayed;
    await route.abort('failed');
  });
  await page.locator('#query').fill('stale-request');
  await Promise.all([
    page.waitForRequest((r) => r.url().includes('q=stale-request')),
    page.locator('#search button').first().click(),
  ]);
  await page.locator('#search-clear').click();
  await page.locator('#status[data-i18n=loaded]').waitFor();
  const failed = page.waitForEvent('requestfailed', (r) => r.url().includes('q=stale-request'));
  release();
  await failed;
  await settle(page);
  assert.equal(await page.locator('#status').getAttribute('data-i18n'), 'loaded');
  assert.notEqual(await page.locator('#status').getAttribute('data-tone'), 'error');
  assert.equal(await page.locator('#search button').first().isEnabled(), true);
  await page.unroute(stale);
}

export async function exerciseAdministrationLoading(page, go) {
  const counts = { '/api/v1/users': 0, '/api/v1/access-groups': 0 };
  const observe = (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path in counts) counts[path]++;
  };
  page.on('request', observe);
  await go('administration');
  await page.locator('#user-rows-empty').waitFor();
  await page.locator('#group-rows-empty').waitFor();
  await settle(page);
  page.off('request', observe);
  assert.deepEqual(counts, { '/api/v1/users': 1, '/api/v1/access-groups': 1 });
  assert.equal(await page.locator('#reset-password button').isDisabled(), true);
  assert.equal(await page.locator('#remove-member').isDisabled(), true);
  assert.equal(await page.locator('#remove-grant').isDisabled(), true);
}

export async function exerciseClearedMessages(page) {
  for (const language of ['en', 'ru']) {
    await page.locator('#language').selectOption(language);
    for (const id of [
      'admin-status',
      'package-status',
      'package-page',
      'package-page-top',
      'updates-status',
    ]) {
      assert.equal(await page.locator(`#${id}`).textContent(), '', `${id}/${language}`);
    }
    for (const id of ['member-group', 'grant-group', 'member-user', 'reset-user'])
      assert.equal(await page.locator(`#${id} option`).count(), 0, id);
  }
}

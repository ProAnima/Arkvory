import { fillKey } from './session.mjs';
import assert from 'node:assert/strict';

export async function exerciseGuides(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#language').selectOption('en');
  await page.locator('#connection-card').evaluate((node) => {
    node.open = true;
  });
  await fillKey(page, fixture.headers.authorization.slice(7));
  await page.locator('#repository').fill('releases');
  await page.locator('[data-nav=help]').first().click();
  await page.locator('#help-load').click();
  await page.locator('#help-operations details').first().waitFor();
  await page.locator('#help-search').fill('GET /api/v1');
  assert.ok((await page.locator('#help-operations details').count()) > 0);
  await fillKey(page, 'x'.repeat(64));
  assert.equal(
    await page.locator('#help-operations details').count(),
    0,
    'Credential changes clear discovery',
  );
  await page.locator('#help-load').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#help-status').dataset.tone === 'error' ||
      document.querySelector('#help-status').textContent.length > 0,
  );
  assert.equal(await page.locator('#help-operations details').count(), 0);
  await page.locator('[data-nav=onboarding]').click();
  await page.locator('#onboarding-panel details summary').click();
  await page.locator('#welcome-name').fill('unsaved-owner');
  await page.locator('#connection-card').evaluate((node) => {
    node.open = false;
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['dark', 'light']) {
      await page.locator('#theme').selectOption(theme);
      for (const language of ['ru', 'en']) {
        await page.locator('#language').selectOption(language);
        assert.equal(await page.locator('#welcome-name').inputValue(), 'unsaved-owner');
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      await page.screenshot({
        path: `test-results/onboarding-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page.locator('#welcome-sign-in').click();
  assert.equal(
    await page.locator('#login-name').evaluate((node) => node === document.activeElement),
    true,
  );
  console.log('PASS onboarding/help: permissions reset, RU/EN, themes, narrow layout and focus');
}

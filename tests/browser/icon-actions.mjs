import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

export async function exerciseIconActions(page) {
  if ((await page.locator('#sidebar-toggle').getAttribute('aria-expanded')) === 'false')
    await page.locator('#sidebar-toggle').click();
  const search = page.getByRole('button', { name: 'Search', exact: true });
  assert.equal(await search.locator('svg[aria-hidden=true]').count(), 1);
  const iconBox = await search.boundingBox();
  assert.ok(iconBox.width >= 44 && iconBox.height >= 44);
  await search.focus();
  const tip = page.locator('#action-tooltip');
  await tip.waitFor({ state: 'visible' });
  assert.equal(await tip.textContent(), 'Search');
  await page.keyboard.press('Escape');
  assert.equal(await tip.isVisible(), false);
  assert.equal(await search.evaluate((node) => node === document.activeElement), true);
  await search.locator('svg').dispatchEvent('pointerover', { pointerType: 'mouse' });
  await tip.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await search.evaluate((node) => {
    node.querySelector('path').dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        relatedTarget: node.querySelector('svg'),
      }),
    );
  });
  assert.equal(
    await tip.isVisible(),
    false,
    'Escape remains dismissed while moving inside an icon',
  );
  await page.locator('#query').focus();
  await page.keyboard.press('Tab');
  await search.focus();
  await tip.waitFor({ state: 'visible' });
  await search.dispatchEvent('pointerout', { pointerType: 'mouse' });
  await page.waitForTimeout(200);
  assert.equal(await tip.isVisible(), true, 'Mouse departure preserves keyboard help');
  await search.evaluate((node) => {
    node.disabled = true;
  });
  await tip.waitFor({ state: 'hidden' });
  await search.evaluate((node) => {
    node.disabled = false;
  });
  await search.focus();
  await tip.waitFor({ state: 'visible' });
  await page.locator('#catalog-panel').evaluate((node) => {
    node.hidden = true;
  });
  await tip.waitFor({ state: 'hidden' });
  await page.locator('#catalog-panel').evaluate((node) => {
    node.hidden = false;
  });
  await page.locator('#query').fill('preserved icon draft');
  await page.locator('#language').selectOption('ru');
  const localized = page.getByRole('button', { name: 'Найти', exact: true });
  assert.equal(await localized.locator('svg').count(), 1);
  assert.equal(await page.locator('#query').inputValue(), 'preserved icon draft');
  await page.locator('#theme').selectOption('light');
  const sun = await page.locator('#theme-icon path').getAttribute('d');
  await page.locator('#theme').selectOption('dark');
  assert.notEqual(await page.locator('#theme-icon path').getAttribute('d'), sun);
  assert.equal(await page.locator('#theme').getAttribute('aria-label'), 'Оформление: Тёмная');
  await page.setViewportSize({ width: 320, height: 844 });
  const languageBox = await page.locator('#language').boundingBox();
  assert.ok(languageBox.width >= 100, 'Language code must not be clipped beside its icon');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#sidebar-toggle').click();
  assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
  const nav = page.getByRole('button', { name: 'Пакеты', exact: true });
  await nav.focus();
  await tip.waitFor({ state: 'visible' });
  const box = await tip.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 1440, 'Rail tooltip stays in the viewport');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#packages-panel').isVisible(), true);
  await page.getByRole('button', { name: 'Артефакты', exact: true }).click();
  assert.equal(await page.locator('#query').inputValue(), 'preserved icon draft');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/icon-rail-dark.png', fullPage: true });
  await page.locator('#sidebar-toggle').click();
  await page.locator('#language').selectOption('en');
  await page.locator('#theme').selectOption('system');
  await page.locator('#query').fill('');
  console.log(
    'PASS icon actions: accessible names, 44px targets, themes, rail, stable Escape/focus, disabled/hidden tooltip cleanup, localization and drafts',
  );
}

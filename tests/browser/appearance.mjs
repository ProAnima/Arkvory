import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { exerciseIconActions } from './icon-actions.mjs';
import { chooseLanguage } from './language.mjs';

export async function exerciseAppearance(page) {
  await exerciseIconActions(page);
  const trigger = page.getByRole('button', { name: 'About artifacts', exact: true });
  const tip = page.locator('[role=tooltip][data-i18n=catalogHint]');
  await trigger.focus();
  assert.equal(await tip.isVisible(), true);
  assert.equal(await trigger.getAttribute('aria-describedby'), await tip.getAttribute('id'));
  await page.keyboard.press('Escape');
  assert.equal(await tip.isVisible(), false);
  assert.equal(await trigger.evaluate((n) => n === document.activeElement), true);
  await page.locator('#page-title').focus();
  await trigger.hover();
  await tip.hover();
  assert.equal(await tip.isVisible(), true, 'Explanation remains readable while hovered');
  await page.keyboard.press('Escape');
  assert.equal(await tip.isVisible(), false);
  await trigger.click();
  assert.equal(await tip.isVisible(), true);
  // A tooltip opened again after the language changed speaks the new language, from the same
  // trigger (choosing a language is an interaction elsewhere, so it closes the pinned tip).
  await chooseLanguage(page, 'ru');
  assert.equal(await tip.isVisible(), false);
  const localized = page.getByRole('button', { name: 'Об артефактах', exact: true });
  assert.equal(await localized.count(), 1);
  await localized.click();
  assert.equal(await tip.isVisible(), true);
  assert.match(await tip.textContent(), /Неизменяемые/);
  await chooseLanguage(page, 'en');
  await page.locator('#theme').selectOption('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.tap();
  assert.equal(await tip.isVisible(), true);
  const box = await tip.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
  const anchor = await trigger.boundingBox();
  assert.ok(
    anchor && (box.y + box.height <= anchor.y || box.y >= anchor.y + anchor.height),
    'Touch help must not cover its dismiss trigger',
  );
  assert.equal(await tip.evaluate((n) => getComputedStyle(n).animationName), 'none');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/console-tooltip-390-dark.png' });
  await trigger.tap();
  assert.equal(await tip.isVisible(), false, 'Second activation dismisses touch help');
  await trigger.tap();
  await page.locator('#page-title').click();
  assert.equal(await tip.isVisible(), false, 'Outside interaction dismisses help');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await trigger.focus();
  assert.equal(await tip.evaluate((n) => getComputedStyle(n).animationName), 'surface-enter');
  await page.keyboard.press('Escape');
  await page.locator('[data-nav=upload]').click();
  const upload = page.locator('#upload-panel');
  assert.equal(
    await upload.evaluate((node) => getComputedStyle(node).animationName),
    'surface-enter',
  );
  // Repeated selection must not replace translated text or its live-region attributes.
  assert.equal(
    await page.evaluate(() => {
      const title = document.querySelector('#page-title');
      const observer = new MutationObserver(() => {});
      observer.observe(title, { childList: true, attributes: true, subtree: true });
      document.querySelector('[data-nav=upload]').click();
      const count = observer.takeRecords().length;
      observer.disconnect();
      return count;
    }),
    0,
  );
  await page.locator('#labels').evaluate((node) => {
    node.value = 'motion-draft';
  });
  await page.evaluate(() => {
    for (const name of ['metadata', 'downloads', 'catalog', 'upload'])
      document.querySelector(`[data-nav=${name}]`).click();
  });
  assert.equal(await page.locator('[data-view]:visible').count(), 1);
  assert.equal(await page.locator('#labels').inputValue(), 'motion-draft');
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  await page.locator('#labels').evaluate((node) => {
    node.value = '';
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await upload.evaluate((node) => getComputedStyle(node).animationName), 'none');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration),
    '0s, 0s, 0s',
  );
  await page.locator('[data-nav=upload]').click();
  const file = page.locator('#file');
  await file.focus();
  const picker = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (
    await picker
  ).setFiles({ name: 'localization.txt', mimeType: 'text/plain', buffer: Buffer.from('UI') });
  const selection = page.locator('#upload-panel .file-control-selection');
  assert.equal(await selection.textContent(), 'localization.txt');
  await chooseLanguage(page, 'ru');
  assert.equal(
    await page.locator('#upload-panel .file-control-action').textContent(),
    'Выбрать файл',
  );
  assert.equal(await selection.textContent(), 'localization.txt');
  await file.evaluate((node) => node.form.reset());
  await page.waitForFunction(() => document.querySelector('#file').files.length === 0);
  assert.equal(await selection.textContent(), 'Файл не выбран');
  await chooseLanguage(page, 'en');
  assert.equal(await selection.textContent(), 'No file selected');
  await page.locator('[data-nav=catalog]').click();
  console.log(
    'PASS appearance: keyboard/hover/touch help, idempotent text, rapid navigation/draft preservation, finite motion, live reduced motion, RU/EN and file picker',
  );
}

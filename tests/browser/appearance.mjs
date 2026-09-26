import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

export async function exerciseAppearance(page) {
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
  // Re-localize an open tooltip without moving focus or re-creating its trigger.
  await page.locator('#language').evaluate((node) => {
    node.value = 'ru';
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await tip.isVisible(), true);
  assert.match(await tip.textContent(), /Неизменяемые/);
  assert.equal(await page.getByRole('button', { name: 'Об артефактах', exact: true }).count(), 1);
  await page.locator('#language').selectOption('en');
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.locator('#language').selectOption('ru');
  assert.equal(
    await page.locator('#upload-panel .file-control-action').textContent(),
    'Выбрать файл',
  );
  assert.equal(await selection.textContent(), 'localization.txt');
  await file.evaluate((node) => node.form.reset());
  await page.waitForFunction(() => document.querySelector('#file').files.length === 0);
  assert.equal(await selection.textContent(), 'Файл не выбран');
  await page.locator('#language').selectOption('en');
  assert.equal(await selection.textContent(), 'No file selected');
  await page.locator('[data-nav=catalog]').click();
  console.log(
    'PASS appearance: keyboard/hover/touch help, live RU/EN, native file picker/reset, viewport and reduced motion',
  );
}

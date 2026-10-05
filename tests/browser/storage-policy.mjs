import { fillKey, jargon } from './session.mjs';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { chooseLanguage } from './language.mjs';

export async function exerciseStoragePolicy(page, f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const url = new URL(page.url()).origin,
    root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: [
        'repository.read',
        'artifact.list',
        'artifact.delete',
        'storage.read',
        'storage.manage',
        'diagnostics.read',
      ],
    },
  ];
  const account = await root.createServiceAccount('ui-storage', bindings),
    issued = await root.issueServiceKey(account.id, 'ui-storage', { name: 'ui-storage', bindings });
  const client = new ArkvoryClient(url, () => issued.secret);
  await client.activateServiceKey();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseLanguage(page, 'en');
  await page.locator('#connection-card').evaluate((e) => {
    e.open = true;
  });
  await fillKey(page, issued.secret);
  await page.locator('[data-nav=catalog]').click();
  await page.locator('#connect-submit').click();
  await page.locator('#storage-panel').waitFor();
  await page.locator('#storage-panel > summary').click();
  await page.waitForFunction(() => !document.querySelector('#storage-save').disabled);
  assert.equal(await page.locator('#storage-enabled').isChecked(), false);
  await page.locator('#storage-grouping').selectOption('repository');
  await page.locator('#storage-keep').fill('7');
  await page.locator('#storage-quota').fill('0.5');
  await page.locator('#storage-protected').fill('bse, release');
  await page.locator('#storage-save').click();
  await page.locator('#storage-status[data-i18n=storageSaved]').waitFor();
  assert.equal((await client.storagePolicy('releases')).policy.keepLast, 7);
  // The quota is typed in GiB, sent as exact bytes and usage is shown in binary units.
  assert.equal((await client.storagePolicy('releases')).policy.quotaBytes, '536870912');
  assert.equal(await page.locator('#storage-quota').inputValue(), '0.5');
  assert.match(await page.locator('#storage-usage').textContent(), / of 512 MiB$/);
  assert.equal(await page.locator('#storage-usage').getAttribute('data-param-quota'), '536870912');
  await page.locator('#storage-quota').fill('12x');
  assert.equal(
    await page.locator('#storage-quota').evaluate((node) => node.validity.patternMismatch),
    true,
  );
  await page.locator('#storage-quota').fill('0');
  await page.locator('#storage-save').click();
  await page.locator('#storage-status[data-i18n=storageQuotaInvalid]').waitFor();
  await page.locator('#storage-quota').fill('0.5');
  await page.locator('#storage-preview').click();
  await page.locator('#storage-status[data-i18n=storagePreviewCount]').waitFor();
  await page.locator('#storage-enabled').check();
  await page.locator('#storage-save').click();
  await page.locator('#storage-status[data-i18n=storageConfirmRequired]').waitFor();
  assert.equal((await client.storagePolicy('releases')).policy.enabled, false);
  await page.locator('#storage-ack').check();
  await page.locator('#storage-save').click();
  await page.locator('#storage-status[data-i18n=storageSaved]').waitFor();
  assert.equal((await client.storagePolicy('releases')).policy.enabled, true);
  await page.locator('#cleanup-panel > summary').click();
  await page.waitForFunction(() => !document.querySelector('#cleanup-fields').disabled);
  assert.equal(await page.locator('#cleanup-enabled').isChecked(), false);
  await page.locator('#cleanup-batch').fill('3');
  await page.locator('#cleanup-enabled').check();
  await page.locator('#cleanup-save').click();
  await page.locator('#cleanup-status[data-i18n=cleanupSaved]').waitFor();
  assert.equal((await client.cleanup('releases')).policy.batchSize, 3);
  await page.locator('#cleanup-run').click();
  await page.locator('#cleanup-status[data-i18n=cleanupRequested]').waitFor();
  await page.locator('#cleanup-enabled').uncheck();
  await page.locator('#cleanup-save').click();
  await page.waitForFunction(
    () => document.querySelector('#cleanup-state').dataset.i18n === 'cleanupPaused',
  );
  assert.equal((await client.cleanup('releases')).policy.enabled, false);
  await page.locator('#storage-keep').fill('9');
  for (const [width, language, theme] of [
    [1440, 'en', 'light'],
    [390, 'ru', 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await chooseLanguage(page, language);
    await page.locator('#theme').selectOption(theme);
    assert.equal(await page.locator('#storage-keep').inputValue(), '9');
    assert.doesNotMatch(await page.locator('#storage-panel').innerText(), jargon, language);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    for (const id of [
      'storage-age',
      'storage-interval',
      'storage-quota',
      'storage-protected',
      'storage-warning',
      'storage-critical',
    ])
      assert.equal(await page.locator('#' + id).isVisible(), true);
    assert.equal(await page.locator('#storage-channels').isVisible(), false);
    // Paint all scroll positions before capturing a full page with fixed navigation.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        scrollTo(0, y);
        await new Promise(requestAnimationFrame);
      }
      scrollTo(0, 0);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({
      path: `test-results/console-storage-${width}-${theme}.png`,
      fullPage: true,
    });
  }
  await page.locator('#connection-card').evaluate((e) => {
    e.open = true;
  });
  await fillKey(page, f.headers.authorization.slice(7));
  assert.equal(await page.locator('#storage-panel').isVisible(), false);
  await page.locator('#connect-submit').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#connection-state').dataset.connected === 'true' &&
      document.querySelector('#catalog-panel').getAttribute('aria-busy') !== 'true',
  );
  assert.equal(await page.locator('#storage-panel').isVisible(), false);
  console.log(
    'PASS storage UI: managed access, disabled preview, global N, quota, explicit activation, RU/EN, themes and context reset',
  );
}

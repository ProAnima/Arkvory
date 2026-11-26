import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';

/**
 * Storage overview: a link opened before sign-in waits for the entry; the page sums the usage of
 * every repository whose storage the key may read, shows the share of a quota as a bar, opens a
 * repository's storage settings from its name and fits a phone in a right-to-left language.
 * Runs after the storage scenario, which leaves a quota on `releases`. Administration alone
 * gives no storage rights, so a service key that may read the storage of `releases` signs in.
 */
export async function exerciseCapacity(browser, origin, f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: ['repository.read', 'artifact.list', 'storage.read'],
    },
  ];
  const account = await root.createServiceAccount('ui-capacity', bindings);
  const issued = await root.issueServiceKey(account.id, 'ui-capacity', {
    name: 'ui-capacity',
    bindings,
  });
  await new ArkvoryClient(origin, () => issued.secret).activateServiceKey();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/console/#/capacity`);
    await chooseLanguage(page, 'en');
    await connectWithKey(page, issued.secret);
    await page.locator('#capacity-panel').waitFor();
    const row = page.locator('#capacity-rows tr', { hasText: 'releases' });
    await row.waitFor();
    assert.equal(await page.locator('#page-title').innerText(), 'Storage overview');
    assert.match(await page.locator('#capacity-count').innerText(), /^[1-9]\d*$/);
    assert.match(await page.locator('#capacity-total').innerText(), /\d/);
    const text = await row.innerText();
    assert.ok(text.includes('512 MiB'), text);
    assert.equal(await row.locator('progress').count(), 1);
    assert.match(
      await row.locator('.badge').innerText(),
      /^(Below thresholds|Near the quota|Almost full|Over the quota)$/,
    );
    // A repository whose usage cannot be read stays a row, and the totals say they leave it out.
    const usage = '**/api/v1/repositories/releases/storage/usage';
    await page.route(usage, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'forbidden', message: 'Forbidden' }),
      }),
    );
    await page.locator('#capacity-refresh').click();
    await page.locator('#capacity-partial').waitFor();
    assert.match(await page.locator('#capacity-partial').innerText(), /could not be read: 1\./);
    assert.ok((await row.innerText()).includes('Cannot read usage'));
    await page.unroute(usage);
    await page.locator('#capacity-refresh').click();
    await row.locator('progress').waitFor();
    assert.equal(await page.locator('#capacity-partial').isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseLanguage(page, 'ar');
    assert.equal(await page.locator('#page-title').innerText(), 'نظرة عامة على التخزين');
    // A language switch rewrites the sizes but keeps the bar next to them.
    assert.equal(await row.locator('progress').count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await chooseLanguage(page, 'en');
    await page.setViewportSize({ width: 1440, height: 900 });
    await row.getByRole('button', { name: 'releases' }).click();
    // The repository connects first, then the catalog shows with its storage panel open.
    await page.waitForFunction(
      () =>
        !document.querySelector('#catalog-panel').hidden &&
        document.querySelector('#storage-panel').open,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

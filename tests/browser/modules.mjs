import assert from 'node:assert/strict';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';

/**
 * Modules & licence (ADR 0078, 0079) for a global administrator: a link opened before sign-in
 * waits for the entry, the page lists the built-in modules of the core with their state and says
 * that no licence is needed, and it fits a phone in a right-to-left language.
 */
export async function exerciseModules(browser, origin, f) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/console/#/modules`);
    await chooseLanguage(page, 'en');
    // Until the licences are read the page claims nothing about them.
    assert.equal(await page.locator('#licence-none').isVisible(), false);
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#modules-panel').waitFor();
    await page.locator('#modules-rows tr').first().waitFor();
    assert.equal(await page.locator('#page-title').innerText(), 'Modules & licence');
    assert.match(await page.locator('#modules-api').innerText(), /^Extension API \d+\.\d+/);
    const rows = await page.locator('#modules-rows tr').allInnerTexts();
    assert.ok(rows.length > 0);
    // Without packages every module is built in; only those that are never off are free core.
    assert.ok(
      rows.every((row) => row.includes('Built in')),
      rows.join('\n'),
    );
    assert.ok(
      rows.some((row) => row.includes('Free core')),
      rows.join('\n'),
    );
    assert.ok(
      rows.some((row) => row.includes('Running')),
      rows.join('\n'),
    );
    // A test installation has no licence; the page says the core needs none.
    assert.equal(await page.locator('#licence-none').isVisible(), true);
    assert.equal(await page.locator('#licence-table').isVisible(), false);
    assert.equal(
      await page.locator('#modules-panel pre').innerText(),
      'sudo arkvory module list --root /opt/proanima-arkvory',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseLanguage(page, 'ar');
    assert.equal(await page.locator('#page-title').innerText(), 'الوحدات والترخيص');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

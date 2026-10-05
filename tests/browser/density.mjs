import assert from 'node:assert/strict';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';

/**
 * The shared console scenario runs with touch emulation, which selects the 44px touch layout.
 * This scenario uses a mouse-only context: the dense desktop layout, every visible view at two
 * widths in both languages, without horizontal overflow and with compact rows and controls.
 */
export async function exerciseDesktopDensity(browser, origin, f) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/console/`);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), false);
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#connection-state[data-connected=true]').waitFor();
    await page.locator('#artifacts tr').first().waitFor();
    // Restricted screens appear after permission discovery; the owner key sees Backups too.
    await page.locator('#backups-nav').waitFor();
    // The page title shares the top bar with the primary action and preferences.
    assert.equal(await page.locator('.topbar #page-title').count(), 1);
    const control = await page.locator('#query').boundingBox();
    assert.ok(control && control.height <= 34, `desktop control height ${String(control?.height)}`);
    const row = await page.locator('#artifacts tr').first().boundingBox();
    assert.ok(row && row.height <= 64, `catalog row height ${String(row?.height)}`);
    const views = await page
      .locator('nav [data-nav]')
      .evaluateAll((nodes) =>
        nodes.filter((node) => node.checkVisibility()).map((node) => node.dataset.nav),
      );
    assert.ok(views.length >= 6, `visible views: ${views.join(', ')}`);
    for (const language of ['en', 'ru']) {
      await chooseLanguage(page, language);
      for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of views) {
          await page.locator(`nav [data-nav=${view}]`).click();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(
            overflow <= 0,
            `${view} overflows by ${String(overflow)}px at ${width} ${language}`,
          );
        }
      }
    }
    console.log(
      'PASS desktop density: mouse layout, title in top bar, 32px controls, compact rows, all views × 1024/1440 × RU/EN without overflow',
    );
  } finally {
    await context.close();
  }
}

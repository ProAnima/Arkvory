import assert from 'node:assert/strict';
import { LANGUAGES } from '../../apps/web/dist/languages.js';

// Each language's own script: a fetched dictionary really replaced the English on the screen.
const SCRIPT = {
  zh: /\p{Script=Han}/u,
  ja: /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u,
  hi: /\p{Script=Devanagari}/u,
  ar: /\p{Script=Arabic}/u,
};
const VIEWS = ['catalog', 'upload', 'downloads', 'packages', 'history', 'metadata', 'help'];

/**
 * Every language the console fetches (English and Russian are checked with every width and
 * theme by the caller): the page takes its direction, nothing is wider than the window at the
 * narrowest and the widest width, no translated control is left blank, and the documentation
 * link opens the same language.
 */
export async function exerciseLanguages(page, go) {
  for (const { code } of LANGUAGES.filter(({ code }) => code !== 'en' && code !== 'ru')) {
    await page.locator('#language').selectOption(code);
    await page.waitForFunction((lang) => document.documentElement.lang === lang, code);
    assert.equal(
      await page.evaluate(() => document.documentElement.dir),
      code === 'ar' ? 'rtl' : 'ltr',
      `${code}: direction`,
    );
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of VIEWS) {
        await go(view);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        if (overflow > 0)
          await page.screenshot({ path: `test-results/console-${code}-${view}-${width}.png` });
        assert.ok(overflow <= 0, `${code}/${view}/${width}: ${String(overflow)}px wider`);
        const blank = await page.evaluate(() =>
          [...document.querySelectorAll('main [data-i18n]')]
            .filter((node) => node.checkVisibility() && node.textContent.trim() === '')
            .map((node) => node.getAttribute('data-i18n')),
        );
        assert.deepEqual(blank, [], `${code}/${view}: blank texts`);
        if (SCRIPT[code])
          assert.match(await page.locator('main').innerText(), SCRIPT[code], `${code}/${view}`);
      }
    }
    assert.match(
      (await page.locator('#help-docs').getAttribute('href')) ?? '',
      new RegExp(`/Arkvory/${code}/$`),
      `${code}: documentation link`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await go('catalog');
    await page.screenshot({ path: `test-results/console-language-${code}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#language').selectOption('en');
}

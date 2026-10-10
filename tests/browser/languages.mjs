import assert from 'node:assert/strict';
import { LANGUAGES } from '../../apps/web/dist/languages.js';
import { chooseLanguage } from './language.mjs';

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
    await chooseLanguage(page, code);
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
  await chooseLanguage(page, 'en');
}

/**
 * The menu itself: the flag and letters of the current language, every item with a flag that
 * loaded, keyboard (arrows, Home, End, a letter, Escape, Enter) and the document's language.
 */
export async function exerciseLanguageMenu(page) {
  const button = page.locator('#language');
  const list = page.locator('#language-list');
  const loaded = (selector) =>
    page
      .locator(selector)
      .evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth > 0));
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  assert.match((await button.getAttribute('aria-label')) ?? '', /English/);
  assert.equal(await loaded('#language img.flag'), true, 'the current flag loads');
  await button.click();
  assert.equal(await list.evaluate((node) => node.matches(':popover-open')), true);
  // The menu reacts to the toggle event, a task after the popover opens (slower on Linux CI).
  await page.waitForFunction(
    () =>
      document.querySelector('#language')?.getAttribute('aria-expanded') === 'true' &&
      document.activeElement?.dataset.lang === 'en',
  );
  await page.screenshot({ path: 'test-results/console-language-menu.png' });
  assert.equal(await list.locator('[role=menuitemradio]').count(), LANGUAGES.length);
  assert.equal(await loaded('#language-list img.flag'), true, 'every flag loads');
  assert.equal(await list.locator('[aria-checked=true]').getAttribute('data-lang'), 'en');
  // The names are each in their own script, whatever the page is in.
  assert.equal(await list.locator('[data-lang=ar] .lang-menu-name').getAttribute('dir'), 'rtl');
  const focused = () => page.evaluate(() => document.activeElement?.dataset.lang ?? '');
  assert.equal(await focused(), 'en', 'the open list starts at the current language');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'ru');
  await page.keyboard.press('End');
  assert.equal(await focused(), 'ar');
  await page.keyboard.press('Home');
  assert.equal(await focused(), 'en');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(), 'ar', 'the list wraps');
  // A letter finds a language by its own name, its letters or its English name.
  await page.keyboard.press('d');
  assert.equal(await focused(), 'de');
  await page.keyboard.press('j');
  assert.equal(await focused(), 'ja');
  await page.keyboard.press('Escape');
  assert.equal(await list.evaluate((node) => node.matches(':popover-open')), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'language');
  await button.focus();
  await page.keyboard.press('ArrowDown');
  // The list opens and takes the focus a moment later; keys go to it once it has.
  await page.waitForFunction(
    () =>
      document.querySelector('#language-list').matches(':popover-open') &&
      document.activeElement?.dataset.lang === 'en',
  );
  await page.keyboard.press('d');
  assert.equal(await focused(), 'de');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  assert.match((await button.getAttribute('aria-label')) ?? '', /Deutsch/);
  assert.equal(await button.locator('.lang-menu-short').textContent(), 'DE');
  await chooseLanguage(page, 'en');
}

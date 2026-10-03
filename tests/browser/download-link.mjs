// Download link from the artifact page (ADR 0062) against the real API.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { setup } from '../integration/fixture.mjs';
import { publish } from '../integration/backup-fixture.mjs';
import { connectWithKey, jargon } from './session.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cleanup = [];
let browser;
try {
  const f = await setup({ after: (fn) => cleanup.push(fn) });
  const artifact = await publish(f, randomBytes(3000));
  const other = await publish(f, randomBytes(100));
  const origin = await f.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ARKVORY_BROWSER_CHANNEL
      ? { channel: process.env.ARKVORY_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/console/#/artifact/releases/${artifact.id}`);
  await page.locator('#language').selectOption('en');
  await connectWithKey(page, f.headers.authorization.slice(7));
  await page.locator('#selected-name').waitFor();
  const button = page.locator('#download-link');
  await button.waitFor({ state: 'visible' });
  await button.click();
  await page.locator('#download-link-result').waitFor({ state: 'visible' });
  const url = await page.locator('#download-link-url').inputValue();
  assert.match(
    url,
    new RegExp(
      `^${origin}/api/v1/repositories/releases/artifacts/${artifact.id}/content\\?token=dtl_`,
    ),
  );
  // Copied when the browser allows the clipboard, otherwise offered for manual copying.
  assert.ok(
    ['downloadLinkCopied', 'downloadLinkCopy'].includes(
      await page.locator('#download-link-note').getAttribute('data-i18n'),
    ),
  );
  assert.ok(await page.locator('#download-link-expiry').getAttribute('data-date'));
  const response = await fetch(url);
  assert.equal(response.status, 200, 'the link downloads without a key');
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(artifact.bytes));
  await page.locator('#language').selectOption('ru');
  assert.match(await page.locator('#download-link-note').innerText(), /только этот файл/);
  assert.doesNotMatch(await page.locator('#download-link-result').innerText(), jargon);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `no horizontal scroll at ${String(width)} px`,
    );
  }
  // The secret leaves the page when another artifact is opened.
  await page.goto(`${origin}/console/#/artifact/releases/${other.id}`);
  await page.waitForFunction(() => document.querySelector('#download-link-result').hidden);
  assert.equal(await page.locator('#download-link-url').inputValue(), '');
  assert.equal(await page.locator('#download-link-result').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS download link: create, copy or show, works without a key, RU/EN, 390px/1440px');
} finally {
  await browser?.close();
  for (const fn of cleanup.reverse()) await fn();
}

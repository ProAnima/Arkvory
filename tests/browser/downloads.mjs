// Browser gate: dedicated PostgreSQL and pinned Playwright Chromium.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { setup, create, base } from '../integration/fixture.mjs';
import { chromium } from 'playwright';
const cleanup = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ARKVORY_BROWSER_CHANNEL ? { channel: process.env.ARKVORY_BROWSER_CHANNEL } : {}),
});
try {
  const f = await setup(
    {
      after(fn) {
        cleanup.push(fn);
      },
    },
    { downloadBytesPerSecond: 4 * 1024 ** 2 },
  );
  const bytes = Buffer.alloc(17 * 1024 ** 2, 0x56),
    id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${id}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const address = await f.listen(),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  // Use real OPFS handles for final destinations; bypass only the OS file picker.
  await page.addInitScript(() => {
    let sequence = 0;
    window.showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle(`test-destination-${sequence++}`, { create: true });
      const writer = await file.createWritable();
      await writer.write('previous destination');
      await writer.close();
      return file;
    };
  });
  await page.goto(`${address}/console/`);
  await page.locator('#language').selectOption('en');
  await page.locator('#token').fill(f.headers.authorization.slice(7));
  await page.locator('#connect button.primary').click();
  await page.locator('#artifacts button').first().click();
  await page.locator('#download').click();
  await page
    .getByRole('cell', { name: '8388608 bytes written', exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .locator('#download-rows tr')
    .first()
    .getByRole('button', { name: 'Pause', exact: true })
    .click();
  await page.getByRole('cell', { name: 'Paused', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      async () =>
        await (
          await (await navigator.storage.getDirectory()).getFileHandle('test-destination-0')
        )
          .getFile()
          .then((file) => file.text()),
    ),
    'previous destination',
  );
  await page
    .locator('#download-rows tr')
    .first()
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click();
  await page
    .getByRole('cell', { name: 'Verified and saved', exact: true })
    .waitFor({ timeout: 20000 });
  const actual = await page.evaluate(async () => {
    const file = await (
      await (await navigator.storage.getDirectory()).getFileHandle('test-destination-0')
    ).getFile();
    return {
      size: file.size,
      hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join(''),
    };
  });
  assert.equal(actual.size, bytes.length);
  assert.equal(actual.hash, createHash('sha256').update(bytes).digest('hex'));
  await page.locator('#downloads-clear-finished').click();
  await page.locator('#download-empty').waitFor();
  // Hold an empty queue, enqueue two selected files, then cancel only waiting entries.
  await page.locator('#downloads-pause').click();
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-nav=metadata]').click();
    await page.locator('#download').click();
  }
  // New jobs respect the explicitly paused queue.
  assert.equal(await page.locator('#downloads-pause').isDisabled(), true);
  await page.waitForFunction(
    () => !document.querySelector('#download-rows')?.textContent.includes('Saving checkpoint'),
  );
  await page.locator('#downloads-clear-waiting').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#download-rows tr')].every((row) =>
      row.textContent.includes('Cancelled'),
    ),
  );
  for (const theme of ['light', 'dark']) {
    await page.locator('#theme').selectOption(theme);
    for (const language of ['en', 'ru']) {
      await page.locator('#language').selectOption(language);
      await page.setViewportSize({ width: language === 'en' ? 1440 : 390, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await mkdir('test-results', { recursive: true });
      await page.screenshot({
        path: `test-results/downloads-${theme}-${language}.png`,
        fullPage: true,
      });
    }
  }
  const originalSession = await page.evaluate(async () => {
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('depot-download-staging-v1');
    const names = [];
    for await (const [name] of root.entries()) names.push(name);
    const own = names[0],
      live = await root.getDirectoryHandle(own);
    const marker = await (
      await live.getFileHandle('live-marker', { create: true })
    ).createWritable();
    await marker.write('keep');
    await marker.close();
    await root.getDirectoryHandle('session-00000000-0000-0000-0000-000000000000', { create: true });
    return own;
  });
  const openOther = async () => {
    const other = await page.context().newPage();
    await other.addInitScript(() => {
      window.showSaveFilePicker = async () =>
        (await navigator.storage.getDirectory()).getFileHandle(`other-${crypto.randomUUID()}`, {
          create: true,
        });
    });
    await other.goto(`${address}/console/`);
    await other.locator('#language').selectOption('en');
    await other.locator('#token').fill(f.headers.authorization.slice(7));
    await other.locator('#connect button.primary').click();
    await other.locator('#artifacts button').first().click();
    await other.locator('[data-nav=downloads]').click();
    await other.locator('#downloads-pause').click();
    await other.locator('[data-nav=metadata]').click();
    await other.locator('#download').click();
    await other.getByRole('cell', { name: 'Waiting', exact: true }).waitFor();
    return other;
  };
  const sessions = () =>
    page.evaluate(async () => {
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('depot-download-staging-v1');
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      return names;
    });
  const other = await openOther(),
    active = await sessions();
  assert.equal(active.length, 2);
  assert.ok(active.includes(originalSession));
  assert.ok(!active.includes('session-00000000-0000-0000-0000-000000000000'));
  const abandoned = active.find((name) => name !== originalSession);
  await other.close();
  const next = await openOther(),
    reclaimed = await sessions();
  assert.equal(reclaimed.length, 2);
  assert.ok(reclaimed.includes(originalSession));
  assert.ok(!reclaimed.includes(abandoned));
  await next.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS browser download: real HTTP/OPFS, pause/resume, verified commit, clearing waiting, RU/EN, light/dark, 390px/1440px',
  );
} finally {
  await browser.close();
  for (const close of cleanup.reverse()) await close();
}

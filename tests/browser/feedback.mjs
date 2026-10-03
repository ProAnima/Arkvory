// Feedback to ProAnimaStudio (ADR 0060) against the real API and a recording hub on loopback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setup } from '../integration/fixture.mjs';
import { connectWithKey, jargon } from './session.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const received = [];
const hub = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const form = await new Response(Buffer.concat(chunks), {
    headers: { 'content-type': request.headers['content-type'] },
  }).formData();
  received.push(form);
  response.writeHead(202, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ id: `hub-${String(received.length)}` }));
});
hub.listen(0, '127.0.0.1');
await once(hub, 'listening');
const cleanup = [() => new Promise((resolve) => hub.close(resolve))];
let browser;
try {
  const f = await setup(
    { after: (fn) => cleanup.push(fn) },
    { hub: { url: `http://127.0.0.1:${String(hub.address().port)}`, project: 'arkvory' } },
  );
  const base = await f.listen();
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ARKVORY_BROWSER_CHANNEL
      ? { channel: process.env.ARKVORY_BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const status = () => page.locator('#report-status').getAttribute('data-i18n');
  const connect = async (secret) => {
    await page.goto(base + '/console/');
    await connectWithKey(page, secret);
    await page.waitForFunction(
      () => document.querySelector('#connection-state').dataset.connected === 'true',
    );
  };
  await connect(f.headers.authorization.slice(7));
  await page.locator('#report-open').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#report-open').click();
  await page.locator('#report-dialog').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'report-message');

  // A screenshot pasted from the clipboard, as after PrintScreen.
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('#report-message').dispatchEvent(event);
  }, png.toString('base64'));
  await page.locator('#report-shots li').first().waitFor();
  assert.match(
    await page.locator('#report-shots li span').first().innerText(),
    /^screenshot-.*\.png · /,
  );
  await page
    .locator('#report-files')
    .setInputFiles([{ name: 'second.png', mimeType: 'image/png', buffer: png }]);
  assert.equal(await page.locator('#report-shots li').count(), 2);
  await page
    .locator('#report-files')
    .setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') }]);
  assert.equal(await status(), 'reportFileType');
  assert.equal(await page.locator('#report-shots li').count(), 2);
  await page.getByRole('button', { name: /second\.png/ }).click();
  assert.equal(await page.locator('#report-shots li').count(), 1);

  // An administrator sees exactly what is attached before sending.
  assert.equal(await page.locator('#report-server-field').isVisible(), true);
  await page.locator('#report-preview > summary').click();
  await page.waitForFunction(() =>
    document.querySelector('#report-preview-text').textContent.includes('"schema"'),
  );
  assert.match(await page.locator('#report-preview-text').innerText(), /Arkvory console/);

  await page.locator('#report-send').click();
  assert.equal(await status(), 'reportMessageRequired');
  await page.locator('#report-message').fill('Пакет не скачивается через прокси');
  await page.locator('#report-email').fill('ops@example.com');
  for (const [width, theme, language] of [
    [1440, 'dark', 'en'],
    [390, 'light', 'ru'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#theme').evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, theme);
    await page.locator('#language').evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, language);
    const box = await page.locator('#report-dialog').boundingBox();
    assert.ok(box && box.width <= width, `dialog fits ${String(width)} px`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.doesNotMatch(await page.locator('#report-dialog').innerText(), jargon);
    await page.screenshot({ path: `test-results/feedback-${String(width)}-${theme}.png` });
  }
  assert.equal(
    await page.locator('#report-message').inputValue(),
    'Пакет не скачивается через прокси',
  );
  await page.locator('#report-send').click();
  await page.waitForFunction(
    () => document.querySelector('#report-status').dataset.i18n === 'reportSent',
  );
  assert.match(await page.locator('#report-status').innerText(), /hub-1/);
  const [form] = received;
  assert.equal(form.get('message'), 'Пакет не скачивается через прокси');
  assert.equal(form.get('email'), 'ops@example.com');
  assert.equal(JSON.parse(form.get('meta')).lang, 'ru');
  assert.equal(form.getAll('screenshot').length, 1);
  assert.deepEqual(
    form.getAll('log').map((file) => file.name),
    ['arkvory-console.log', 'arkvory-api.log', 'arkvory-system.json'],
  );
  assert.equal(await page.locator('#report-shots li').count(), 0, 'sent images are released');
  await page.locator('#report-cancel').click();
  assert.equal(await page.locator('#report-dialog').isVisible(), false);

  // Another key, without administration: no server log; signed out: no form.
  await connect(f.readerHeaders.authorization.slice(7));
  await page.locator('#report-open').click();
  assert.equal(await page.locator('#report-server-field').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.locator('#connection-card > summary').click();
  await page.locator('#logout').click();
  await page.waitForFunction(() => document.querySelector('#token').value === '');
  assert.equal(await page.locator('#report-open').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS feedback: paste/choose/remove screenshots, type refusal, attachment preview, server log for administrators only, sent form, RU/EN, light/dark, 390px/1440px',
  );
} finally {
  await browser?.close();
  for (const fn of cleanup.reverse()) await fn();
}

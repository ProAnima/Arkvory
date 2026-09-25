import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createRemoteWizard } from '../../apps/deploy/dist/remote-server.js';

const job = {
  state: {
    destination: 'root@192.0.2.1:22',
    phase: 'fingerprint',
    fingerprint: 'SHA256:example-key-to-verify',
    target: null,
    version: '',
    url: '',
    error: '',
  },
  active: true,
  discover: async () => {},
  inspect: async () => {
    job.state.target = { platform: 'linux', packaging: 'deb', installed: false };
    job.state.phase = 'review';
  },
  install: async () => {
    job.state.phase = 'ready';
    job.state.url = 'http://127.0.0.1:8080';
  },
  close: () => {
    job.state.phase = 'closed';
  },
};
const wizard = await createRemoteWizard({ factory: () => job });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DEPOT_BROWSER_CHANNEL ? { channel: process.env.DEPOT_BROWSER_CHANNEL } : {}),
});
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage();
  await page.goto(wizard.url);
  for (const [lang, scheme, width] of [
    ['ru', 'dark', 390],
    ['en', 'light', 1440],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(new URL(`/?lang=${lang}`, wizard.url).href);
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `test-results/remote-${lang}-${scheme}.png`, fullPage: true });
  }
  await page.locator('[name=host]').fill('192.0.2.1');
  await page.locator('[name=username]').fill('root');
  await page.locator('[name=password]').fill('never-render-ssh-secret');
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/discover',
  );
  await page.locator('button').click();
  assert.equal(
    (await submitted).status(),
    303,
    'same-origin browser form must pass origin and CSRF checks',
  );
  await page.getByText('SHA256:example-key-to-verify', { exact: true }).waitFor();
  assert.ok(!(await page.content()).includes('never-render'));
  await page.locator('[name=trusted]').check();
  await page.locator('form[action^="/inspect"] button').click();
  await page.locator('form[action^="/install"] button').waitFor();
  await page.locator('[name=ownerPassword]').fill('never-render-owner-secret');
  await page.locator('form[action^="/install"] button').click();
  await page.locator('a.button').waitFor();
  assert.equal(
    await page.locator('a.button').getAttribute('href'),
    'http://127.0.0.1:8080/console/#onboarding',
  );
  await page.locator('form[action^="/reset"] button').click();
  await page.locator('[name=host]').waitFor();
  assert.equal(await page.locator('[name=password]').inputValue(), '');
  console.log(
    'PASS remote wizard: trust, preview, single-action dispatch, result, reset, RU/EN, light/dark, narrow layout',
  );
} finally {
  await browser.close();
  wizard.close();
}

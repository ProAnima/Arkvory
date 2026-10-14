import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';
import { separateInstance } from '../integration/mirror-fixture.mjs';
import { base, create } from '../integration/fixture.mjs';

/**
 * The Sites page (ADR 0077) on two real installations: this server becomes a controller (a key
 * file to seal site keys), a second installation is the site. The administrator checks the
 * address, pairs with the code the site made, sees the site's state and content, makes a code for this
 * site and removes the site again. Restarts the shared server: runs before the mirror scenario.
 */
export async function exerciseFleet(browser, f, cleanup) {
  const secrets = await mkdtemp(join(tmpdir(), 'arkvory-fleet-ui-'));
  const keyFile = join(secrets, 'fleet.key');
  await writeFile(keyFile, randomBytes(32).toString('hex'));
  f.config.fleetKeyFile = keyFile;
  f.config.siteName = 'Main';
  await f.restart();
  const origin = await f.listen();
  const site = await separateInstance(
    {
      after(fn) {
        cleanup.push(fn);
      },
    },
    { siteName: 'Branch' },
  );
  const siteAddress = await site.app.listen({ host: '127.0.0.1', port: 0 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/console/`);
    await chooseLanguage(page, 'en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('[data-nav=fleet]').click();
    await page.locator('#fleet-empty').waitFor();
    assert.match(await page.locator('#fleet-self').innerText(), /^Main, version /);
    assert.equal(await page.locator('#fleet-controllers-empty').isVisible(), true);
    // Check the address: plain HTTP on loopback has no certificate to compare.
    await page.locator('#fleet-url').fill(siteAddress);
    await page.locator('#fleet-check').click();
    await page.locator('#fleet-probe').waitFor();
    assert.match(await page.locator('#fleet-compare').innerText(), /no certificate to check/);
    assert.equal(await page.locator('#fleet-certificate').isVisible(), false);
    // The code is made on the site, by its own administrator.
    const made = await site.app.inject({
      method: 'POST',
      url: '/api/v1/system/fleet/pairings',
      headers: site.headers,
    });
    await page.locator('#fleet-code').fill(made.json().code);
    await page.locator('#fleet-pair').click();
    await page.locator('#fleet-add-status[data-tone=success]').waitFor();
    assert.equal(await page.locator('#fleet-add-status').innerText(), 'Branch is paired.');
    const row = page.locator('#fleet-rows tr').first();
    await row.waitFor();
    const text = await row.innerText();
    for (const expected of [
      'Branch',
      siteAddress,
      'Working',
      'writer',
      'One server',
      'None',
      'Active 0, waiting 0',
    ])
      assert.ok(text.includes(expected), `${expected} in ${text}`);
    assert.equal(await row.locator('.fleet-badge').getAttribute('data-state'), 'ok');
    // The site key never reaches the page.
    assert.doesNotMatch(await page.content(), /afk_/);
    // The content of the site, read through this installation: descriptions, never bytes.
    const bytes = Buffer.from('branch tool');
    const id = (await create(site, bytes)).json().id;
    await site.app.inject({
      method: 'PUT',
      url: `${base}/uploads/${id}/content`,
      headers: { ...site.headers, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    await site.app.inject({
      method: 'PUT',
      url: `${base}/asset`,
      headers: site.headers,
      payload: { path: 'tools/branch.bin', artifactId: id, expectedRevision: 0 },
    });
    await row.getByRole('button', { name: 'Content' }).click();
    await page.locator('#fleet-file-rows tr').first().waitFor();
    assert.equal(await page.locator('#fleet-content-title').innerText(), 'Content of Branch');
    assert.equal(await page.locator('#fleet-repository').inputValue(), 'releases');
    assert.ok((await page.locator('#fleet-file-rows').innerText()).includes('tools/branch.bin'));
    assert.ok((await page.locator('#fleet-file-rows').innerText()).includes(id));
    assert.equal(await page.locator(`#fleet-artifact-rows td[title="${id}"]`).count(), 1);
    await page.locator('#fleet-query').fill('nothing-like-this');
    await page.locator('#fleet-content-filter button').click();
    await page.locator('#fleet-artifacts-empty').waitFor();
    await page.locator('#fleet-files-empty').waitFor();
    await page.locator('#fleet-content-close').click();
    assert.equal(await page.locator('#fleet-content').isVisible(), false);
    // This site's own pairing code.
    await page.locator('#fleet-make-code').click();
    await page.locator('#fleet-code-box').waitFor();
    assert.match(
      await page.locator('#fleet-code-value').innerText(),
      /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/,
    );
    assert.match(await page.locator('#fleet-code-until').innerText(), /^Valid until .+ shown once/);
    assert.match(await page.locator('#fleet-code-fingerprint').innerText(), /TLS ends at a proxy/);
    // Russian, then a phone: the table scrolls inside its region, the page does not.
    await chooseLanguage(page, 'ru');
    assert.equal((await page.locator('[data-nav=fleet]').innerText()).trim(), 'Площадки');
    assert.ok((await row.innerText()).includes('Работает'));
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `page scrolls sideways by ${String(overflow)}px`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseLanguage(page, 'en');
    // Removing asks first; the safe choice is focused.
    await row.getByRole('button', { name: 'Remove' }).click();
    const dialog = page.locator('#action-confirm');
    await dialog.waitFor();
    assert.match(await page.locator('#action-confirm-text').innerText(), /Stop managing Branch/);
    await page.locator('#action-confirm-proceed').click();
    await page.locator('#fleet-empty').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  console.log(
    'PASS sites: check, pair by code, site state, content, own code, remove, RU/EN, 390px',
  );
}

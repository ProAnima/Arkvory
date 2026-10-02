import assert from 'node:assert/strict';
import { connectWithKey } from './session.mjs';

/**
 * The connected repository is a mirror (ADR 0058): the server restarts with `releases` mirrored
 * from another installation. The catalog shows a compact badge whose state follows the sync
 * state, the source in the help tooltip, and no upload action; reads keep working. Runs last:
 * it changes the server configuration of the shared fixture.
 */
export async function exerciseMirror(browser, f) {
  f.config.mirrors = [
    { repository: 'releases', upstream: 'https://source.example', sourceRepository: 'builds' },
  ];
  await f.restart();
  const origin = await f.listen();
  const state = (sql) => f.catalog.pool.query(sql);
  await state(`INSERT INTO arkvory_mirror_state(repository, source, phase, cursor, head,
      checked_at, synced_at) VALUES('releases', 'https://source.example|builds', 'following',
      7, 7, now(), now())`);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/console/`);
    await page.locator('#language').selectOption('en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    const badge = page.locator('#mirror-badge');
    await badge.waitFor();
    assert.equal(await page.locator('#mirror-state').getAttribute('data-state'), 'synced');
    assert.equal((await badge.textContent()).trim(), 'Mirror');
    // No upload action in a mirror; artifact screens follow operation discovery, which offers
    // no change of a mirrored repository.
    assert.equal(await page.locator('#heading-upload').isVisible(), false);
    assert.equal(await page.locator('[data-nav=upload]').isVisible(), false);
    await page.locator('#artifacts tr').first().waitFor();
    // The tooltip names the source; the server keeps the key, the console never sees it.
    await page.locator('#mirror-state .help-trigger').hover();
    const details = page.locator('#mirror-details');
    await details.waitFor();
    assert.match(await details.textContent(), /“builds” from source\.example/);
    // A failed attempt turns the badge into a warning; downloads keep working.
    await state(`UPDATE arkvory_mirror_state SET error_code='unavailable', error_at=now()`);
    await page.reload();
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#mirror-state[data-state=failing]').waitFor();
    assert.equal((await badge.textContent()).trim(), 'Mirror · sync error');
    await page.locator('#language').selectOption('ru');
    assert.equal((await badge.textContent()).trim(), 'Зеркало · ошибка синхронизации');
    // Import mode (dev -> prod): an ordinary repository, so uploads stay; the badge explains.
    f.config.mirrors[0] = { ...f.config.mirrors[0], stages: ['release'] };
    await f.restart();
    const importing = await f.listen();
    await state(`UPDATE arkvory_mirror_state SET error_code=NULL, error_at=NULL`);
    await page.goto(`${importing}/console/`);
    await page.locator('#language').selectOption('en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#mirror-state[data-state=synced]').waitFor();
    assert.equal((await badge.textContent()).trim(), 'Imports');
    assert.equal(await page.locator('#heading-upload').isVisible(), true);
    await page.locator('#mirror-state .help-trigger').hover();
    assert.match(await details.textContent(), /marked release in “builds”/);
    assert.deepEqual(errors, []);
    console.log(
      'PASS mirror: badge per sync state, source in the tooltip, no upload action, RU/EN; import badge keeps uploads',
    );
  } finally {
    await context.close();
  }
}

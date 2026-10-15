import assert from 'node:assert/strict';
import { connectWithKey } from './session.mjs';
import { chooseLanguage } from './language.mjs';

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
    // Time flows as usual; a refresh is brought forward instead of waited for.
    await page.clock.install();
    // The badge's first read fails: it is read again, and the mirror is marked after all.
    const failed = { status: 500, json: { code: 'internal', message: 'Internal error' } };
    await page.route('**/repositories/releases/mirror', (route) => route.fulfill(failed), {
      times: 1,
    });
    const firstRead = page.waitForResponse('**/repositories/releases/mirror');
    await page.goto(`${origin}/console/`);
    await chooseLanguage(page, 'en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    const badge = page.locator('#mirror-badge');
    await firstRead;
    assert.equal(await badge.isVisible(), false);
    await page.clock.fastForward(20_000);
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
    // The Mirrors page lists it in sync.
    await page.locator('[data-nav=mirrors]').click();
    const rows = page.locator('#mirrors-rows tr');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 1);
    assert.match(
      await rows.first().innerText(),
      /releases[\s\S]*“builds” on source\.example[\s\S]*In sync/,
    );
    // A refused key stops it: the badge turns into a warning, and the reason with the command
    // that fixes it is in view, on the catalog and on the Mirrors page; downloads keep working.
    await state(`UPDATE arkvory_mirror_state SET error_code='unauthorized', error_at=now()`);
    // A reload on #/mirrors would reopen that page after sign-in; the badge is on the catalog.
    await page.locator('[data-nav=catalog]').click();
    await page.reload();
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#mirror-state[data-state=failing]').waitFor();
    assert.equal((await badge.textContent()).trim(), 'Mirror · sync error');
    const problem = page.locator('#mirror-problem');
    assert.match(await problem.innerText(), /no longer accepts this server’s key/);
    assert.match(
      await problem.locator('code').innerText(),
      /arkvory configure --root <root> --mirror releases --mirror-token-file <key file>/,
    );
    assert.match(
      (await problem.locator('a').getAttribute('href')) ?? '',
      /\/Arkvory\/operate\/mirrors#error-codes$/,
    );
    await page.locator('[data-nav=mirrors]').click();
    await page.locator('#mirrors-rows .mirror-badge[data-state=failing]').waitFor();
    assert.match(await rows.first().innerText(), /Sync error[\s\S]*no longer accepts/);
    // The page follows the server without a reload: a cleared failure shows within a refresh.
    await state(`UPDATE arkvory_mirror_state SET error_code=NULL, error_at=NULL`);
    await page.clock.fastForward(20_000);
    await page.locator('#mirrors-rows .mirror-badge[data-state=synced]').waitFor();
    // Two reads in flight: the older answer, arriving last, never replaces the newer one.
    let release = () => undefined;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(
      '**/api/v1/mirrors',
      async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await held;
        body.items[0] = {
          ...body.items[0],
          errorCode: 'unauthorized',
          errorAt: body.items[0].checkedAt,
        };
        await route.fulfill({ response, json: body });
      },
      { times: 1 },
    );
    await page.locator('[data-nav=catalog]').click();
    const newer = page.waitForResponse('**/api/v1/mirrors');
    await page.locator('[data-nav=mirrors]').click();
    await page.clock.fastForward(20_000);
    await newer;
    const older = page.waitForResponse('**/api/v1/mirrors');
    release();
    await older;
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('#mirrors-rows .mirror-badge').getAttribute('data-state'),
      'synced',
    );
    await state(`UPDATE arkvory_mirror_state SET error_code='mirror_unreachable', error_at=now()`);
    await page.locator('[data-nav=catalog]').click();
    await page.clock.fastForward(20_000);
    await page.locator('#mirror-state[data-state=failing]').waitFor();
    assert.match(await problem.innerText(), /source\.example cannot be reached/);
    // Nothing wider than a phone in the stopped state.
    await page.setViewportSize({ width: 320, height: 800 });
    for (const view of ['catalog', 'mirrors']) {
      await page.locator(`[data-nav=${view}]`).evaluate((node) => node.click());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `${view} at 320px: ${String(overflow)}px wider`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-nav=catalog]').click();
    await chooseLanguage(page, 'ru');
    assert.equal((await badge.textContent()).trim(), 'Зеркало · ошибка синхронизации');
    assert.match(await problem.innerText(), /source\.example недоступен/);
    // Import mode (dev -> prod): an ordinary repository, so uploads stay; the badge explains.
    f.config.mirrors[0] = { ...f.config.mirrors[0], stages: ['release'] };
    await f.restart();
    const importing = await f.listen();
    await state(`UPDATE arkvory_mirror_state SET error_code=NULL, error_at=NULL`);
    await page.goto(`${importing}/console/`);
    await chooseLanguage(page, 'en');
    await connectWithKey(page, f.headers.authorization.slice(7));
    await page.locator('#mirror-state[data-state=synced]').waitFor();
    assert.equal((await badge.textContent()).trim(), 'Import');
    assert.equal(await page.locator('#heading-upload').isVisible(), true);
    await page.locator('#mirror-state .help-trigger').hover();
    assert.match(await details.textContent(), /marked release in “builds”/);
    assert.deepEqual(errors, []);
    console.log(
      'PASS mirror: badge per sync state, source in the tooltip, reason and fix in view, Mirrors page refreshing by itself, 320px, RU/EN; import badge keeps uploads',
    );
  } finally {
    await context.close();
  }
}

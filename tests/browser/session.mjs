// Sign-in, deep links, phone layout and destructive admin confirmations against the real API.
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { chromium } from 'playwright';
import { chooseLanguage } from './language.mjs';

/** Internal terms that must not reach people in RU/EN copy (technical help keeps API names). */
export const jargon =
  /\bGC\b|\bgateways?\b|\bworkers?\b|\bbootstrap\b|ревизи|повторного запроса|билд/i;

/** Opens the secondary service-key form and types a key without connecting yet. */
export async function fillKey(page, secret) {
  const card = page.locator('#connection-card');
  if (!(await card.evaluate((node) => node.open))) await card.locator(':scope > summary').click();
  const disclosure = page.locator('#token-login');
  if (!(await disclosure.evaluate((node) => node.open)))
    await disclosure.locator(':scope > summary').click();
  await page.locator('#token').fill(secret);
}

export async function connectWithKey(page, secret) {
  await fillKey(page, secret);
  await page.locator('#connect-submit').click();
}

/** Every word of every visible button label renders on one line (no mid-word wrapping). */
async function splitWords(page, scope) {
  return page.locator(scope).evaluate((root) => {
    const split = [];
    for (const button of root.querySelectorAll('button')) {
      if (!button.checkVisibility()) continue;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const match of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          if (lines.size > 1) split.push(match[0]);
        }
    }
    return split;
  });
}

async function phoneLayout(page) {
  for (const width of [375, 390])
    for (const language of ['ru', 'en']) {
      await page.setViewportSize({ width, height: 844 });
      await chooseLanguage(page, language);
      assert.deepEqual(await splitWords(page, '#connection-card'), [], `${width}/${language}`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  await page.setViewportSize({ width: 1280, height: 900 });
  await chooseLanguage(page, 'en');
}

/**
 * Headless browsers hide scrollbars by default; the rail regression needs real ones. A short
 * window gives the rail a vertical scrollbar, which used to add a horizontal one as well.
 */
async function railLayout(url) {
  const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    ...(process.env.ARKVORY_BROWSER_CHANNEL
      ? { channel: process.env.ARKVORY_BROWSER_CHANNEL }
      : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 420 } });
    await page.goto(url);
    for (const [width, height] of [
      [800, 420],
      [790, 500],
      [1024, 600],
    ])
      for (const navigation of ['compact', 'expanded']) {
        await page.setViewportSize({ width, height });
        await page.evaluate(
          (mode) => (document.documentElement.dataset.navigation = mode),
          navigation,
        );
        const rail = await page.locator('.sidebar').evaluate((node) => ({
          overflow: node.scrollWidth - node.clientWidth,
          scrollbar: node.offsetHeight - node.clientHeight,
        }));
        assert.deepEqual(rail, { overflow: 0, scrollbar: 0 }, `${width}x${height} ${navigation}`);
      }
  } finally {
    await browser.close();
  }
}

async function signInUser(root) {
  const password = 'sign-in-fixture-password';
  const user = await root.createUser('ui-signin', password, false);
  const group = await root.createAccessGroup('ui-signin-readers');
  await root.setGroupGrant(group.id, 'releases', 'read');
  await root.setGroupMember(group.id, user.id, true);
  return { name: 'ui-signin', password };
}

export async function exerciseSignIn(browser, origin, f, artifactId) {
  const root = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  const account = await signInUser(root);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const link = `#/artifact/releases/${artifactId}`;
  await page.goto(`${origin}/console/${link}`);
  await chooseLanguage(page, 'en');
  // People sign in with a password first; the key form stays collapsed and Disconnect hidden.
  assert.equal(await page.locator('#login-name').isVisible(), true);
  assert.equal(await page.locator('#token').isVisible(), false);
  assert.equal(await page.locator('#logout').isVisible(), false);
  await page.locator('#status[data-i18n=routeSignIn]').waitFor();
  assert.equal(await page.locator('#repository').inputValue(), 'releases');
  await phoneLayout(page);
  await railLayout(`${origin}/console/`);
  await page.locator('#login-name').fill(account.name);
  await page.locator('#login-password').fill('wrong-password-value');
  await page.locator('#login button.primary').click();
  await page.locator('#status[data-i18n=signInFailed][data-tone=error]').waitFor();
  assert.equal(await page.locator('#connection-state').getAttribute('data-connected'), 'false');
  await page.locator('#login-password').fill(account.password);
  await page.locator('#login button.primary').click();
  await page.locator('#connection-state[data-connected=true]').waitFor();
  // The deep link restores the artifact after sign-in; the URL carries no credential.
  await page.locator('#selected-name').waitFor();
  assert.equal(await page.locator('#selected-name').textContent(), 'artifact.upack');
  assert.equal(await page.evaluate(() => location.hash), link);
  assert.equal((await page.evaluate(() => location.href)).includes(account.password), false);
  await page.locator('#connection-card > summary').click();
  assert.equal(await page.locator('#logout').isVisible(), true);
  await page.locator('#connection-card > summary').click();
  await page.locator('[data-nav=packages]').click();
  assert.equal(await page.evaluate(() => location.hash), '#/packages');
  await page.goBack();
  await page.locator('#metadata-panel').waitFor();
  assert.equal(await page.evaluate(() => location.hash), link);
  await page.evaluate(() => (location.hash = '#/missing-section'));
  await page.locator('#status[data-i18n=routeUnknown]').waitFor();
  assert.equal(await page.locator('#catalog-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => location.hash), '#/catalog');
  await page.evaluate(() => (location.hash = '#/administration'));
  await page.locator('#status[data-i18n=routeUnavailable]').waitFor();
  assert.equal(await page.locator('#administration-panel').isVisible(), false);
  await page.locator('[data-nav=help]').click();
  assert.equal(await page.locator('#help-hint').getAttribute('data-i18n'), 'helpHintConnected');
  // A revoked session is reported as ended (not expired) and sign-in is offered again.
  const session = await page.locator('#token').inputValue();
  await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${session}` },
  });
  await page.locator('[data-nav=catalog]').click();
  await page.locator('#search button').first().click();
  await page.locator('#status[data-i18n=sessionEnded]').waitFor();
  assert.equal(await page.locator('#connection-state').getAttribute('data-connected'), 'false');
  assert.equal(await page.locator('#logout').isVisible(), false);
  assert.equal(
    await page.locator('#login-name').evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(await page.locator('#help-hint').getAttribute('data-i18n'), 'helpHint');
  await exerciseOwnerServices(page, f);
  assert.deepEqual(errors, []);
  await page.close();
  console.log(
    'PASS sign-in: password first, key collapsed, wrong password, deep link restore, Back, unknown/forbidden routes, revoked session, owner services, 375/390 px labels, rail scrollbars',
  );
}

/** The file-based owner key manages access but is not a service account; explain the next step. */
async function exerciseOwnerServices(page, f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  await connectWithKey(page, f.headers.authorization.slice(7));
  await page.locator('#services-nav').waitFor();
  await page.locator('[data-nav=services]').click();
  await page.locator('#service-account-list [data-i18n=serviceEmpty]').waitFor();
  // The owner-key explanation is a tooltip next to the empty state.
  await page
    .locator('#service-account-list [role=tooltip][data-i18n=serviceEmptyOwner]')
    .waitFor({ state: 'attached' });
  await page.locator('[data-nav=help]').click();
  assert.equal(await page.locator('#help-hint').getAttribute('data-i18n'), 'helpHintConnected');
}

async function confirmDialog(page, accept) {
  const dialog = page.locator('#action-confirm');
  await dialog.waitFor();
  assert.equal(
    await page
      .locator('#action-confirm-cancel')
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.locator(accept ? '#action-confirm-proceed' : '#action-confirm-cancel').click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Disabling a user, removing a member and removing a grant all ask before acting. */
export async function exerciseAdminConfirmations(page) {
  const row = page.locator('#user-rows tr').filter({ hasText: 'ui-reviewer' });
  await row.locator('button').click();
  await confirmDialog(page, false);
  assert.equal(await row.locator('td').nth(2).getAttribute('data-i18n'), 'enabled');
  await row.locator('button').click();
  assert.match(await page.locator('#action-confirm-text').textContent(), /ui-reviewer/);
  await confirmDialog(page, true);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#user-rows tr')].some(
      (tr) => tr.textContent.includes('ui-reviewer') && tr.querySelector('[data-i18n=disabled]'),
    ),
  );
  await row.locator('button').click();
  await row.locator('td[data-i18n=enabled]').waitFor();
  await page.locator('summary[data-i18n=createGroup]').click();
  await page.locator('#new-group-name').fill('ui-confirm');
  await page.locator('#create-group button').click();
  await page.getByRole('cell', { name: 'ui-confirm', exact: true }).waitFor();
  await page.locator('summary[data-i18n=manageMembers]').click();
  await page.locator('#member-group').selectOption({ label: 'ui-confirm' });
  await page.locator('#member-user').selectOption({ label: 'ui-reviewer' });
  await page.locator('#group-member button[data-i18n=addMember]').click();
  const group = page.locator('#group-rows tr').filter({ hasText: 'ui-confirm' });
  await group.filter({ hasText: 'ui-reviewer' }).waitFor();
  await page.locator('#remove-member').click();
  await confirmDialog(page, false);
  assert.match(await group.textContent(), /ui-reviewer/);
  await page.locator('#remove-member').click();
  await confirmDialog(page, true);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#group-rows tr')].some(
      (tr) => tr.textContent.includes('ui-confirm') && !tr.textContent.includes('ui-reviewer'),
    ),
  );
  await page.locator('summary[data-i18n=manageGrants]').click();
  await page.locator('#grant-group').selectOption({ label: 'ui-confirm' });
  await page.locator('#grant-repository').fill('releases');
  await page.locator('#group-grant button[data-i18n=saveGrant]').click();
  await group.locator('[data-i18n=grantRepository]').waitFor();
  await page.locator('#remove-grant').click();
  assert.match(await page.locator('#action-confirm-text').textContent(), /releases/);
  await confirmDialog(page, true);
  await group.locator('[data-i18n=grantRepository]').waitFor({ state: 'detached' });
  for (const summary of ['createGroup', 'manageMembers', 'manageGrants'])
    await page.locator(`summary[data-i18n=${summary}]`).click();
  console.log('PASS admin confirmations: disable user, remove member and remove grant ask first');
}

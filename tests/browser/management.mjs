import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup } from '../integration/fixture.mjs';
import { exerciseLostKeyResponse } from './management-failures.mjs';

const cleanup = [],
  secret = randomUUID() + randomUUID();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ARKVORY_BROWSER_CHANNEL ? { channel: process.env.ARKVORY_BROWSER_CHANNEL } : {}),
});
try {
  const f = await setup(
    { after: (fn) => cleanup.push(fn) },
    {
      keys: [
        {
          sha256: createHash('sha256').update(secret).digest('hex'),
          principal: {
            id: 'management-browser',
            repositories: ['releases'],
            permissions: ['read', 'write'],
            administrator: true,
            serviceAdministrator: true,
          },
        },
      ],
    },
  );
  const base = await f.listen(),
    client = new ArkvoryClient(base, () => secret);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const go = async (view) => {
    if (!(await page.locator(`[data-nav=${view}]`).isVisible()))
      await page.locator('#navigation-toggle').click();
    await page.locator(`[data-nav=${view}]`).click();
  };
  await page.goto(base + '/console/');
  await page.locator('#language').selectOption('en');
  await page.locator('#token').fill(secret);
  await page.locator('#connect button.primary').click();
  await page.locator('#services-nav').waitFor();
  await go('repositories');
  await page.locator('[data-repository-id=releases]').waitFor();
  await page.locator('[data-repository-id=releases] button[data-i18n=repositoryOpen]').click();
  await page.locator('#services-nav').waitFor();
  assert.equal(await page.locator('#repository').inputValue(), 'releases');
  await go('services');
  await page.locator('#service-account-list [data-i18n=managementEmpty]').waitFor();
  await page.locator('summary[data-i18n=serviceCreate]').click();
  await page.locator('#service-create-name').fill('browser-ci');
  const create = page.locator('#service-create-form');
  await create.locator('[data-i18n=bindingAdd]').click();
  await create.locator('.binding-row input').first().fill('releases');
  await create.locator('[data-i18n=bindingRead]').click();
  await create.locator('button[type=submit]').click();
  await page.locator('#service-selected').waitFor();
  const account = (await client.serviceAccounts()).items.find((a) => a.name === 'browser-ci');
  assert.ok(account);
  await page.locator('summary[data-i18n=keyIssue]').click();
  await page.locator('#service-key-name').fill('browser-key');
  assert.equal(
    await page.locator('#service-key-form input[data-permission="artifact.delete"]').isDisabled(),
    true,
  );
  await page.locator('#service-key-form button[type=submit]').click();
  await page.locator('#key-secret-dialog').waitFor();
  const firstSecret = await page.locator('#issued-secret').inputValue();
  assert.equal(firstSecret.startsWith('arkvory_'), true);
  assert.equal(await page.locator('#key-secret-dialog [data-i18n=keyActivate]').isDisabled(), true);
  await page.locator('#secret-saved').check();
  await page.locator('#key-secret-dialog [data-i18n=keyActivate]').click();
  await page.locator('#key-secret-dialog [data-i18n=keyActivated]').waitFor();
  await page.locator('#key-secret-dialog [data-i18n=managementClose]').click();
  assert.equal((await page.locator('#issued-secret').inputValue()).length, 0);
  const firstKey = (await client.serviceKeys(account.id)).items[0];
  assert.equal(firstKey.state, 'active');
  await page.locator(`[data-key-id="${firstKey.id}"] [data-i18n=keyRotate]`).click();
  await page.locator('#service-key-form button[type=submit]').click();
  await page.locator('#key-secret-dialog').waitFor();
  const replacementSecret = await page.locator('#issued-secret').inputValue();
  await page.locator('#secret-saved').check();
  await page.locator('#key-secret-dialog [data-i18n=keyActivate]').click();
  await page.locator('#key-secret-dialog [data-i18n=keyActivated]').waitFor();
  await page.locator('#key-secret-dialog [data-i18n=managementClose]').click();
  const replacement = (await client.serviceKeys(account.id)).items.find(
    (k) => k.rotatedFrom === firstKey.id,
  );
  assert.ok(replacement);
  await page.locator(`[data-key-id="${firstKey.id}"] [data-i18n=keyRevoke]`).click();
  assert.equal(
    await page
      .locator('#management-confirm-dialog [data-i18n=managementConfirmSubmit]')
      .isDisabled(),
    true,
  );
  await page.locator('#management-confirm-name').fill(firstKey.name);
  await page.locator('#management-confirm-dialog [data-i18n=managementConfirmSubmit]').click();
  await page.locator(`[data-key-id="${firstKey.id}"] [data-i18n=keyRevoked]`).waitFor();
  await assert.rejects(
    () => new ArkvoryClient(base, () => firstSecret).me(),
    (e) => e.status === 401,
  );

  // Concurrent policy edits retain the unsent form until the operator explicitly reloads.
  await exerciseLostKeyResponse(page, client, account.id);
  const before = await client.serviceAccount(account.id);
  await client.setServicePolicy(account.id, before.revision, before.bindings);
  await page.locator('summary[data-i18n=servicePolicy]').click();
  await page.locator('#service-policy-form button[type=submit]').click();
  await page.locator('#services-status[data-i18n=errorConflict]').waitFor();
  assert.equal(
    await page.locator('#service-policy-form .binding-row input').first().inputValue(),
    'releases',
  );
  await page.locator('#service-selected [data-i18n=serviceRefresh]').click();
  await page.waitForFunction(() => !document.querySelector('#services-controls').disabled);

  const target = await client.createServiceAccount('delegated-target', before.bindings);
  await page.locator(`[data-key-id="${replacement.id}"] [data-i18n=delegations]`).click();
  await page.locator('summary[data-i18n=delegationNew]').click();
  await page.locator('#delegation-target').fill(target.id);
  for (const action of ['service-account.read', 'credential.read', 'credential.manage'])
    await page.locator(`[data-admin-permission="${action}"]`).check();
  await page
    .locator('#delegation-target')
    .locator('xpath=ancestor::form')
    .locator('[data-i18n=bindingAdd]')
    .click();
  const delegation = page.locator('#delegation-target').locator('xpath=ancestor::form');
  await delegation.locator('.binding-row input').first().fill('releases');
  await delegation.locator('[data-i18n=bindingRead]').click();
  await delegation.locator('button[type=submit]').click();
  await page.locator('#services-status[data-i18n=managementSaved]').waitFor();
  const delegated = new ArkvoryClient(base, () => replacementSecret);
  assert.equal(
    (await delegated.serviceAccounts()).items.some((a) => a.id === target.id),
    true,
  );

  const viewer = await browser.newPage();
  await viewer.goto(base + '/console/');
  await viewer.locator('#language').selectOption('en');
  await viewer.locator('#token').fill(replacementSecret);
  await viewer.locator('#connect button.primary').click();
  await viewer.locator('#services-nav').waitFor();
  await viewer.locator('#services-nav').click();
  await viewer.locator(`[data-account-id="${target.id}"]`).waitFor();
  assert.equal(await viewer.locator('summary[data-i18n=serviceCreate]').isVisible(), false);
  await viewer.locator(`[data-account-id="${target.id}"] button`).click();
  await viewer.locator('#service-selected').waitFor();
  assert.equal(await viewer.locator('#service-policy-form button[type=submit]').isDisabled(), true);
  assert.equal(await viewer.locator('[data-i18n=serviceDisable]').isVisible(), false);
  await viewer.close();

  const audit = page
    .locator('details')
    .filter({ has: page.locator('summary[data-i18n=serviceAudit]') });
  await audit.locator('summary').click();
  await audit.locator('button[data-i18n=managementReload]').click();
  await audit.locator('time').first().waitFor();
  await page.locator('#service-selected button[data-i18n=serviceDisable]').click();
  await page.locator('#management-confirm-name').fill(account.name);
  await page.locator('#management-confirm-dialog [data-i18n=managementConfirmSubmit]').click();
  await page.locator('#service-selected button[data-i18n=serviceEnable]').waitFor();
  await assert.rejects(
    () => delegated.me(),
    (e) => e.status === 401,
  );
  await page.locator('#service-selected button[data-i18n=serviceEnable]').click();
  await page.locator('#service-selected button[data-i18n=serviceDisable]').waitFor();
  assert.equal((await delegated.me()).id.startsWith('service:'), true);
  await page.locator(`[data-key-id="${replacement.id}"] [data-i18n=delegations]`).click();
  await page.locator('button[data-i18n=delegationRemove]').click();
  await page.locator('#management-confirm-name').fill(target.id);
  await page.locator('#management-confirm-dialog [data-i18n=managementConfirmSubmit]').click();
  await page.waitForFunction(() => !document.querySelector('#services-controls').disabled);
  await assert.rejects(
    () => delegated.serviceAccount(target.id),
    (e) => e.status === 404,
  );

  await mkdir('test-results', { recursive: true });
  for (const width of [320, 390, 1440])
    for (const theme of ['light', 'dark'])
      for (const language of ['ru', 'en']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#theme').selectOption(theme);
        await page.locator('#language').selectOption(language);
        for (const view of ['services', 'repositories']) {
          await go(view);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `${view}/${width}/${theme}/${language}`,
          );
          if (language === 'ru')
            await page.screenshot({
              path: `test-results/management-${view}-${width}-${theme}.png`,
              fullPage: true,
            });
        }
      }
  // Clearing the identity erases dynamic administration forms, including any issued secret.
  await page.locator('#connection-card > summary').click();
  await page.locator('#token').fill('');
  await page.locator('#language').selectOption('en');
  assert.equal(await page.locator('#services-controls').textContent(), '');
  assert.equal((await page.locator('#issued-secret').inputValue()).length, 0);
  assert.equal(await page.locator('#services-nav').isVisible(), false);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(storage.includes(firstSecret) || storage.includes(replacementSecret), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS management: repository selection, account/policy CAS, key issue/activation/rotation/revoke, delegation, restricted UI, private reset and responsive RU/EN themes',
  );
} finally {
  await browser.close();
  for (const close of cleanup.reverse()) await close();
}

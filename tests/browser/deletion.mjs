import { fillKey } from './session.mjs';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { create, base } from '../integration/fixture.mjs';
import { chooseLanguage } from './language.mjs';

export async function exerciseDeletion(page, f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new ArkvoryClient(new URL(page.url()).origin, () =>
    f.headers.authorization.slice(7),
  );
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: [
        'repository.read',
        'artifact.read',
        'artifact.list',
        'annotation.read',
        'artifact.delete',
      ],
    },
  ];
  const account = await root.createServiceAccount('ui-cleaner', bindings);
  const issued = await root.issueServiceKey(account.id, 'ui-cleaner', {
    name: 'ui-cleaner',
    bindings,
  });
  await new ArkvoryClient(new URL(page.url()).origin, () => issued.secret).activateServiceKey();
  const bytes = Buffer.from('UI deletion acceptance');
  const id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: base + '/uploads/' + id + '/content',
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseLanguage(page, 'en');
  await fillKey(page, issued.secret);
  await page.locator('[data-nav=catalog]').click();
  await page.locator('#query').fill('');
  await page.locator('#filter-label').fill('');
  await page.locator('#connect-submit').click();
  const row = page.locator('#artifacts tr').filter({ hasText: id });
  await row.waitFor();
  await row.locator('button').first().click();
  await page.locator('#artifact-deletion').waitFor();
  await page.locator('#artifact-deletion summary').click();
  const reference = {
    method: 'POST',
    url: base + '/artifacts/' + id + '/references',
    headers: f.headers,
    payload: { key: 'ui-pinned-deployment' },
  };
  assert.equal((await f.app.inject(reference)).statusCode, 204);
  await page.locator('#deletion-inspect').click();
  await page.locator('#deletion-status[data-i18n=deletionBlocked]').waitFor();
  assert.equal(await page.locator('#deletion-form').isVisible(), false);
  assert.equal(await page.locator('#deletion-reasons li[data-i18n=deletionReference]').count(), 1);
  assert.equal((await f.app.inject({ ...reference, method: 'DELETE' })).statusCode, 204);
  await page.locator('#deletion-inspect').click();
  await page.waitForFunction(() => !document.querySelector('#deletion-confirm').disabled);
  assert.equal(
    await page.locator('#deletion-confirm').evaluate((n) => n === document.activeElement),
    true,
  );
  assert.equal(await page.locator('#deletion-submit').isDisabled(), true);
  await page.locator('#deletion-confirm').fill('wrong-id');
  assert.equal(await page.locator('#deletion-submit').isDisabled(), true);
  // The preview is advisory: an annotation edit must invalidate a prepared delete.
  await root.annotate('releases', id, 0, {
    labels: ['release'],
    collections: [],
    metadata: { status: 'reviewed' },
  });
  await page.locator('#deletion-confirm').fill(id);
  await page.locator('#deletion-submit').click();
  await page.locator('#deletion-status[data-i18n=deletionRecheck]').waitFor();
  assert.equal((await root.artifact('releases', id)).status, 'available');
  await page.locator('#deletion-inspect').click();
  await page.waitForFunction(() => !document.querySelector('#deletion-confirm').disabled);
  await page.locator('#deletion-confirm').fill(id);
  for (const [width, language, theme] of [
    [1440, 'en', 'light'],
    [390, 'ru', 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await chooseLanguage(page, language);
    await page.locator('#theme').selectOption(theme);
    assert.equal(await page.locator('#deletion-confirm').inputValue(), id);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      path: `test-results/console-deletion-${width}-${theme}.png`,
      fullPage: true,
    });
  }
  await page.locator('#deletion-submit').click();
  await page.locator('#catalog-panel').waitFor();
  await page.waitForFunction(
    () => document.querySelector('#catalog-panel').getAttribute('aria-busy') !== 'true',
  );
  assert.equal(await page.locator('#artifact-deletion').isVisible(), false);
  assert.equal(await row.count(), 0);
  await assert.rejects(root.artifact('releases', id), { status: 404 });
  console.log(
    'PASS deletion UI: scoped key, dependency preview, ID confirmation, stale revision protection, RU/EN and both themes',
  );
}

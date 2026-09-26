import assert from 'node:assert/strict';

export async function exerciseLostKeyResponse(page, client, accountId) {
  const pattern = `**/api/v1/service-accounts/${accountId}/keys`;
  const attempts = [];
  let dropped = false;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push(route.request().headers()['idempotency-key']);
    if (dropped) return route.continue();
    dropped = true;
    // Execute the actual mutation, then lose its response before it reaches the UI.
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await response.dispose();
    await route.abort('failed');
  });
  await page.locator('summary[data-i18n=keyIssue]').click();
  await page.locator('#service-key-name').fill('lost-response');
  await page.locator('#service-key-form button[type=submit]').click();
  await page.locator('#services-status[data-tone=error]').waitFor();
  await page.locator('#service-key-form button[type=submit]').click();
  await page.locator('#services-status[data-i18n=keySecretMissing]').waitFor();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(
    (await client.serviceKeys(accountId)).items.filter((k) => k.name === 'lost-response').length,
    1,
  );
  assert.equal(await page.locator('#key-secret-dialog').isVisible(), false);
  await page.unroute(pattern);
}

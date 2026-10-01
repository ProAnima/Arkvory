import { fillKey } from './session.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function exerciseBuildDetails(page, f, buildId) {
  const root = `/api/v1/repositories/releases/artifacts/${buildId}`;
  await page.locator('#metadata-advanced summary').click();
  await page.locator('#metadata-add').click();
  const metadata = page.locator('#metadata-fields .metadata-row').last();
  await metadata.locator('input').nth(0).fill('git.commit');
  await metadata.locator('input').nth(1).fill('abc123');
  await page
    .locator('#label-presets button')
    .filter({ hasText: /^staging$/ })
    .click();
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/annotations') && r.request().method() === 'PUT'),
    page.locator('#annotation-save').click(),
  ]);
  const annotation = (
    await f.app.inject({ url: root + '/annotations', headers: f.headers })
  ).json();
  assert.equal(annotation.metadata['git.commit'], 'abc123');
  assert.ok(annotation.labels.includes('staging'));
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 1024, 65);
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  await page.route('**/uploads/*/parts/1', async (route) => {
    await gate;
    await route.abort();
  });
  await page
    .locator('#attachment-file')
    .setInputFiles({ name: 'build-manifest.json', mimeType: 'application/json', buffer: bytes });
  await page.locator('#attachment-description').fill('CI manifest — test fixture');
  await Promise.all([
    page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/parts/1')),
    page.locator('#attachment-submit').click(),
  ]);
  assert.equal(await page.locator('#attachment-file').isDisabled(), true);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
    'Active attachment upload protects against leaving the page',
  );
  await page.locator('#attachment-pause').click();
  unblock();
  await page.waitForFunction(() => !document.querySelector('#attachment-submit').disabled);
  await page.unroute('**/uploads/*/parts/1');
  const uploadId = await page.locator('#attachment-upload-id').inputValue();
  assert.match(uploadId, /^[a-f0-9-]{36}$/);
  const parts = (
    await f.app.inject({
      url: `/api/v1/repositories/releases/uploads/${uploadId}/parts`,
      headers: f.headers,
    })
  ).json();
  assert.equal(parts.items.length, 1);
  await page.locator('#attachment-submit').click();
  await page.locator('#attachment-list .attachment-row').waitFor();
  const attached = (await f.app.inject({ url: root + '/attachments', headers: f.headers })).json();
  assert.equal(attached.revision, 1);
  assert.equal(attached.items[0].artifactId, uploadId);
  const artifact = (
    await f.app.inject({
      url: `/api/v1/repositories/releases/artifacts/${uploadId}`,
      headers: f.headers,
    })
  ).json();
  assert.equal(artifact.descriptor.sha256, createHash('sha256').update(bytes).digest('hex'));
  // A stale edit must retain the current view and unsent form; reload is explicit.
  await page.locator('#attachment-name').fill('draft.json');
  const external = await f.app.inject({
    method: 'PUT',
    url: root + '/attachments',
    headers: f.headers,
    payload: { expectedRevision: 1, items: attached.items },
  });
  assert.equal(external.statusCode, 200);
  await page.locator('#attachment-list button[data-attachment-mutation]').click();
  await page.locator('#attachment-status[data-tone=error]').waitFor();
  assert.equal(await page.locator('#attachment-list .attachment-row').count(), 1);
  await page.locator('#attachment-reload').click();
  await page.waitForFunction(() =>
    document.querySelector('#attachment-count').textContent.includes('version 2'),
  );
  assert.equal(await page.locator('#attachment-name').inputValue(), 'draft.json');
  await page.locator('#attachment-list button[data-attachment-mutation]').click();
  await page.waitForFunction(
    () => document.querySelector('#attachment-list').children.length === 0,
  );
  await page.locator('#build-attachments summary[data-i18n=attachmentHistory]').click();
  await page.locator('#attachment-history-load').click();
  await page.locator('#attachment-history-rows button[data-attachment-mutation]').first().click();
  await page.locator('#attachment-list .attachment-row').waitFor();
  assert.equal(
    (await f.app.inject({ url: root + '/attachments', headers: f.headers })).json().revision,
    4,
  );
  await page.locator('#build-attachments summary[data-i18n=attachmentHistory]').click();
  // The same endpoint/UI works with read-only credentials and suppresses write controls.
  const viewer = await page.context().browser().newPage();
  await viewer.goto(page.url());
  await viewer.locator('#language').selectOption('en');
  await fillKey(viewer, f.readerHeaders.authorization.slice(7));
  await viewer.locator('#connect-submit').click();
  // The shared artifact link opens the same build once the reader has connected.
  assert.equal(new URL(page.url()).hash, `#/artifact/releases/${buildId}`);
  await viewer.locator('#attachment-list .attachment-row').waitFor();
  assert.equal(await viewer.locator('#selected').inputValue(), buildId);
  assert.equal(await viewer.locator('#attachment-form').isVisible(), false);
  assert.equal(await viewer.locator('#annotation-save').isDisabled(), true);
  assert.equal(
    await viewer.locator('#attachment-list button[data-attachment-mutation]').count(),
    0,
  );
  await viewer.close();
  console.log(
    'PASS build UI: metadata fields, label presets, multipart pause/resume, CAS conflict/reload, unlink/history/restore, read-only visibility',
  );
}

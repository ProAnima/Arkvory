// Error feedback against the real API (ADR 0051): field highlighting from server
// details, request ID, Retry-After hint, session expiry on a password form, RU/EN.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ru } from '../../apps/web/dist/messages.js';

const password = 'error-fixture-password';
const uuid = /^[0-9a-f-]{36}$/;
const digest = (token) => createHash('sha256').update(token).digest('hex');

async function signIn(page, name, secret) {
  await page.locator('#login-name').fill(name);
  await page.locator('#login-password').fill(secret);
  await page.locator('#login button.primary').click();
}

/** Server-named fields are marked, described, focused, translated and cleared on edit. */
async function fieldFromServer(page) {
  await signIn(page, 'bad name!', password);
  await page.locator('#login-name[aria-invalid=true]').waitFor();
  assert.equal(await page.locator('#status').getAttribute('data-i18n'), 'errorFields');
  assert.equal(await page.locator('#login-name-error').getAttribute('data-i18n'), 'fieldInvalid');
  assert.equal(
    await page.locator('#login-name').getAttribute('aria-describedby'),
    'login-name-error',
  );
  assert.equal(await page.locator('#login-password').getAttribute('aria-invalid'), null);
  assert.equal(
    await page.locator('#login-name').evaluate((node) => node === document.activeElement),
    true,
  );
  assert.match(await page.locator('#request-id .request-id-value').textContent(), uuid);
  await page.locator('#language').selectOption('ru');
  assert.equal(await page.locator('#login-name-error').textContent(), ru.fieldInvalid);
  assert.equal(await page.locator('#status').textContent(), ru.errorFields);
  assert.equal(
    await page.locator('#request-id [data-i18n=requestIdLabel]').textContent(),
    ru.requestIdLabel,
  );
  await page.locator('#language').selectOption('en');
  await page.locator('#login-name').fill('ui-errors');
  assert.equal(await page.locator('#login-name').getAttribute('aria-invalid'), null);
  assert.equal(await page.locator('#login-name-error').isVisible(), false);
}

/** A wrong current password blames the field; an expired session ends the session instead. */
async function passwordForm(page, f) {
  await signIn(page, 'ui-errors', password);
  await page.locator('#connection-state[data-connected=true]').waitFor();
  await page.locator('#connection-card > summary').click();
  await page.locator('#current-password').fill('wrong-current-password');
  await page.locator('#own-new-password').fill('next-fixture-password');
  await page.locator('#change-password button').click();
  await page.locator('#current-password[aria-invalid=true]').waitFor();
  assert.equal(await page.locator('#status').getAttribute('data-i18n'), 'currentPasswordWrong');
  assert.equal(await page.locator('#connection-state').getAttribute('data-connected'), 'true');
  const session = await page.locator('#token').inputValue();
  await f.catalog.pool.query(
    "UPDATE arkvory_user_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [digest(session)],
  );
  await page.locator('#current-password').fill(password);
  await page.locator('#change-password button').click();
  await page.locator('#status[data-i18n=sessionExpired]').waitFor();
  assert.equal(await page.locator('#connection-state').getAttribute('data-connected'), 'false');
  assert.equal(await page.locator('#current-password').getAttribute('aria-invalid'), null);
}

/** 429 shows the server's delay beside the message, in both languages. */
async function retryAfter(page, f) {
  // The browser shares the per-address budget of 127.0.0.1; exhaust it before signing in.
  for (let index = 0; index < 12; index++) {
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '127.0.0.1',
      payload: { name: `nobody-${String(index)}`, password },
    });
    if (response.statusCode === 429) break;
  }
  await signIn(page, 'ui-errors', password);
  await page.locator('#status[data-i18n=errorRateLimited]').waitFor();
  const retry = page.locator('#request-id .error-ref-retry');
  assert.match(await retry.textContent(), /^Try again in \d+ s\.$/);
  assert.match(await page.locator('#request-id .request-id-value').textContent(), uuid);
  await page.locator('#language').selectOption('ru');
  assert.match(await retry.textContent(), /^Повторите через \d+ с\.$/);
  await page.locator('#language').selectOption('en');
}

/** Runs last in console.mjs: it exhausts the sign-in budget of 127.0.0.1 on that server. */
export async function exerciseErrorFeedback(browser, origin, f) {
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'ui-errors', password },
  });
  assert.equal(created.statusCode, 201, created.body);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/console/`);
  await page.locator('#language').selectOption('en');
  await fieldFromServer(page);
  await passwordForm(page, f);
  await retryAfter(page, f);
  assert.deepEqual(errors, []);
  await page.close();
  console.log(
    'PASS error feedback: server-named fields, request ID, wrong current password vs expired session, Retry-After, RU/EN',
  );
}

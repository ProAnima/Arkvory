// Console error feedback (ADR 0051, docs/CONSOLE_UX.md): message by code+reason, then status;
// request ID and Retry-After shown beside the message. A tiny DOM stands in for the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
  DownloadQueueError,
} from '@proanima/arkvory-sdk';
import { errorReasons } from '@proanima/arkvory-contracts';
import { en, ru } from '../apps/web/dist/messages.js';

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parent = undefined;
    this.ownText = '';
    this.className = '';
    this.id = '';
    this.hidden = false;
  }
  get classList() {
    return { contains: (name) => this.className.split(' ').includes(name) };
  }
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.children = [];
    this.ownText = value;
  }
  get childElementCount() {
    return this.children.length;
  }
  get parentElement() {
    return this.parent;
  }
  get nextElementSibling() {
    const siblings = this.parent?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  setAttribute(name, value) {
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = value;
    else this.attributes.set(name, value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[camel(name.slice(5))] ?? null;
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
    else this.attributes.delete(name);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.ownText = '';
    this.append(...nodes);
  }
  after(node) {
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }
}
globalThis.HTMLElement = FakeElement;
globalThis.HTMLButtonElement = class {};
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  documentElement: {},
  querySelectorAll: () => [],
};
const { describeError, errorReference, fieldProblems, credentialRejected, UiError } =
  await import('../apps/web/dist/error-keys.js');
const { consoleRunner } = await import('../apps/web/dist/console-runner.js');
const { describeCredential } = await import('../apps/web/dist/feedback.js');
const { setLanguage } = await import('../apps/web/dist/i18n.js');
// The host locale must not decide the expected texts.
setLanguage('en');

const status = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  capacity_exceeded: 507,
  integrity_mismatch: 422,
  busy: 503,
  unavailable: 503,
  rate_limited: 429,
  read_only: 405,
  internal: 500,
};
const http = (code, reason, extra = {}) =>
  new ArkvoryHttpError(status[code] ?? 400, code, 'request-1', extra.retryAfterMs, {
    ...(reason ? { reason } : {}),
    ...extra,
  });

test('every code and reason of the contract has a precise, localized message', () => {
  const generic = new Set(['errorGeneric']);
  for (const [code, reasons] of Object.entries(errorReasons)) {
    const coded = describeError(http(code), 'key');
    assert.ok(Object.hasOwn(en, coded) && Object.hasOwn(ru, coded), code);
    assert.equal(generic.has(coded), false, code);
    for (const reason of reasons) {
      const key = describeError(http(code, reason), 'session');
      assert.ok(Object.hasOwn(en, key), `${code}/${reason}`);
      assert.equal(generic.has(key), false, `${code}/${reason}`);
    }
  }
  // Capacity kinds never collapse into one "storage" message.
  const capacity = errorReasons.capacity_exceeded.map((r) =>
    describeError(http('capacity_exceeded', r), 'key'),
  );
  assert.equal(new Set(capacity).size, capacity.length);
  assert.equal(describeError(http('conflict', 'upload_expired'), 'key'), 'errorUploadExpired');
  assert.equal(describeError(http('read_only'), 'key'), 'errorReadOnly');
  assert.equal(describeError(http('internal'), 'key'), 'errorInternal');
  assert.match(en.errorInternal, /request ID/);
  assert.equal(describeError(http('forbidden', 'read_only_token'), 'key'), 'errorReadOnlyToken');
  assert.equal(describeError(http('forbidden', 'permission_missing'), 'key'), 'errorForbidden');
  assert.equal(describeError(http('forbidden', 'session_required'), 'key'), 'errorSessionRequired');
  assert.equal(describeError(http('rate_limited', 'login_attempts'), 'none'), 'errorRateLimited');
  assert.equal(describeError(http('rate_limited'), 'key'), 'errorTooManyRequests');
  assert.equal(
    describeError(
      http('invalid_input', 'validation', { details: [{ field: '/name', problem: 'invalid' }] }),
      'none',
    ),
    'errorFields',
  );
  assert.equal(describeError(http('invalid_input', 'validation'), 'none'), 'errorInput');
});

test('401 wording depends on reason and on how the page authenticated', () => {
  const cases = [
    ['invalid_credentials', 'none', 'signInFailed'],
    ['current_password_invalid', 'session', 'currentPasswordWrong'],
    ['session_expired', 'session', 'sessionExpired'],
    ['credential_invalid', 'session', 'sessionEnded'],
    ['token_expired', 'key', 'errorTokenExpired'],
    ['credential_invalid', 'key', 'errorUnauthorized'],
    ['credential_missing', 'key', 'errorSignInRequired'],
    ['session_expired', 'none', 'errorSignInRequired'],
    [undefined, 'session', 'sessionExpired'],
    ['a_future_reason', 'key', 'errorUnauthorized'],
  ];
  for (const [reason, credential, key] of cases)
    assert.equal(
      describeError(http('unauthorized', reason), credential),
      key,
      `${reason} ${credential}`,
    );
  assert.equal(credentialRejected(http('unauthorized', 'session_expired')), true);
  assert.equal(credentialRejected(http('unauthorized', 'invalid_credentials')), false);
  assert.equal(credentialRejected(http('unauthorized', 'current_password_invalid')), false);
  assert.equal(credentialRejected(http('forbidden')), false);
});

test('answers without the envelope, local and network failures read by kind, never by text', () => {
  const proxy = (s) => new ArkvoryHttpError(s, 'http_error', '');
  assert.equal(describeError(proxy(502), 'key'), 'errorGateway');
  assert.equal(describeError(proxy(504), 'key'), 'errorGateway');
  assert.equal(describeError(proxy(500), 'key'), 'errorInternal');
  assert.equal(describeError(proxy(413), 'key'), 'errorBodyTooLarge');
  assert.equal(describeError(proxy(418), 'key'), 'errorGeneric');
  assert.equal(
    describeError(new ArkvoryHttpError(409, 'brand_new_code', 'r'), 'key'),
    'errorConflict',
  );
  assert.equal(describeError(http('conflict', 'reason_from_the_future'), 'key'), 'errorConflict');
  assert.equal(describeError(new ArkvoryNetworkError(), 'key'), 'errorNetwork');
  assert.equal(describeError(new DOMException('slow', 'TimeoutError'), 'key'), 'errorTimeout');
  assert.equal(describeError(new DOMException('stop', 'AbortError'), 'key'), 'cancelled');
  assert.equal(describeError(new ArkvoryIntegrityError(), 'key'), 'errorIntegrity');
  assert.equal(describeError(new DownloadQueueError('queue_full'), 'key'), 'downloadQueueFull');
  for (const [code, key] of [
    ['size_mismatch', 'mismatch'],
    ['file_changed', 'mismatch'],
    ['upload_cancelled', 'errorUploadState'],
    ['completion_failed', 'errorCompletionFailed'],
    ['invalid_response', 'errorUnexpectedResponse'],
  ])
    assert.equal(describeError(new ArkvoryClientError(code, 'English text'), 'key'), key, code);
  // The old text matching is gone: a plain Error with the same text is generic.
  assert.equal(describeError(new Error('File size differs from upload'), 'key'), 'errorGeneric');
  assert.equal(describeError(new UiError('stageInvalid'), 'key'), 'stageInvalid');
});

test('references and fields come from the error itself', () => {
  assert.deepEqual(errorReference(http('busy', undefined, { retryAfterMs: 2500 })), {
    requestId: 'request-1',
    retryAfterSeconds: 3,
  });
  assert.deepEqual(errorReference(new ArkvoryHttpError(502, 'http_error', '')), {});
  assert.deepEqual(errorReference(new Error('x')), {});
  const details = [{ field: '/name', problem: 'format' }];
  assert.deepEqual(fieldProblems(http('invalid_input', 'validation', { details })), details);
  assert.deepEqual(
    fieldProblems(new UiError('stageInvalid', [{ field: 'stage', problem: 'format' }])),
    [{ field: 'stage', problem: 'format' }],
  );
  assert.deepEqual(fieldProblems(new Error('x')), []);
});

function statusBar() {
  const bar = new FakeElement('div');
  const output = new FakeElement('output');
  output.id = 'status';
  const reference = new FakeElement('span');
  reference.id = 'request-id';
  reference.className = 'error-ref';
  bar.append(output, reference);
  return { bar, output, reference };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the runner shows the message with request ID and retry hint, then clears them', async () => {
  describeCredential('key');
  const { output, reference } = statusBar();
  const run = consoleRunner(output);
  run(async () => {
    throw http('busy', undefined, { retryAfterMs: 4000 });
  });
  await settle();
  assert.equal(output.dataset.i18n, 'errorBusy');
  assert.equal(output.dataset.tone, 'error');
  assert.equal(reference.children.length, 2);
  const [retry, id] = reference.children;
  assert.equal(retry.dataset.i18n, 'retryIn');
  assert.equal(retry.textContent, 'Try again in 4 s.');
  assert.equal(id.children[1].textContent, 'request-1');
  assert.equal(id.children[1].className, 'request-id-value');
  // A local failure has no reference; the previous one must not linger.
  run(async () => {
    throw new UiError('chooseFileError');
  });
  await settle();
  assert.equal(output.dataset.i18n, 'chooseFileError');
  assert.equal(reference.children.length, 0);
});

test('a panel without a static reference gets one beside its message', async () => {
  const panel = new FakeElement('section');
  const output = new FakeElement('output');
  panel.append(output);
  const run = consoleRunner(output);
  run(async () => {
    throw http('internal');
  });
  await settle();
  const reference = output.nextElementSibling;
  assert.equal(reference.className, 'error-ref');
  assert.match(reference.textContent, /request-1/);
  // A session expiry is handed to the page once; the panel then shows nothing.
  let handed;
  const expiring = consoleRunner(output, (error) => {
    handed = error;
    return true;
  });
  expiring(async () => {
    throw http('unauthorized', 'session_expired');
  });
  await settle();
  assert.equal(handed.reason, 'session_expired');
  assert.equal(output.dataset.i18n, 'errorInternal');
  expiring(async () => {
    throw http('unauthorized', 'current_password_invalid');
  });
  await settle();
  assert.equal(output.dataset.i18n, 'currentPasswordWrong');
});

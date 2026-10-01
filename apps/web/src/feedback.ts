import { ArkvoryHttpError, ArkvoryIntegrityError, DownloadQueueError } from '@proanima/arkvory-sdk';
import type { MessageKey } from './messages.js';
import { message } from './i18n.js';
export type Credential = 'none' | 'session' | 'key';
// The page has exactly one active credential; 401 wording depends on how it was obtained.
let credential: Credential = 'none';
export function describeCredential(next: Credential) {
  credential = next;
}
const unauthorized = {
  none: 'errorSignInRequired',
  session: 'sessionExpired',
  key: 'errorUnauthorized',
} as const satisfies Record<Credential, MessageKey>;
export class UiError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}
export function errorKey(error: unknown): MessageKey {
  if (error instanceof DownloadQueueError)
    return error.code === 'wait_timeout'
      ? 'downloadWaitTimeout'
      : error.code === 'queue_full'
        ? 'downloadQueueFull'
        : 'errorInput';
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'downloadDiskFull';
  if (error instanceof UiError) return error.key;
  if (error instanceof ArkvoryIntegrityError) return 'errorIntegrity';
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof ArkvoryHttpError) {
    if (error.status === 401) return unauthorized[credential];
    if (error.status === 403) return 'errorForbidden';
    if (error.status === 404) return 'errorNotFound';
    if (error.status === 409) return 'errorConflict';
    if (error.status === 400) return 'errorInput';
    if (error.status === 422) return 'errorIntegrity';
    if (error.status === 429) return 'errorRateLimited';
    if (error.status === 503) return 'errorBusy';
    if (error.status === 507) return 'errorCapacity';
  }
  if (
    error instanceof Error &&
    ['File size differs from upload', 'Selected file does not match uploaded parts'].includes(
      error.message,
    )
  )
    return 'mismatch';
  return 'errorGeneric';
}
export function feedback(
  node: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
  tone: 'info' | 'success' | 'error' = 'info',
) {
  if (node.id === 'status' && node.parentElement) node.parentElement.hidden = false;
  node.dataset['tone'] = tone;
  message(node, key, params);
}

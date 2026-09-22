import { DepotHttpError } from '@proanima/depot-sdk';
import type { MessageKey } from './messages.js';
import { message } from './i18n.js';
export class UiError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}
export function errorKey(error: unknown): MessageKey {
  if (error instanceof UiError) return error.key;
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof DepotHttpError) {
    if (error.status === 401) return 'errorUnauthorized';
    if (error.status === 403) return 'errorForbidden';
    if (error.status === 404) return 'errorNotFound';
    if (error.status === 409) return 'errorConflict';
    if (error.status === 400) return 'errorInput';
    if (error.status === 422) return 'errorIntegrity';
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
  node.dataset['tone'] = tone;
  message(node, key, params);
}

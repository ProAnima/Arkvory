import { element } from './dom.js';
import { message } from './i18n.js';
import type { MessageKey } from './messages.js';

/**
 * Modal confirmation for actions that remove access or data. Cancel, Escape and closing the
 * dialog (for example on sign-out) resolve false; only the explicit action button resolves
 * true. `details` (for example a list of what is kept and removed) is shown under the text and
 * removed when the dialog closes.
 */
export function confirmAction(
  text: MessageKey,
  params: Readonly<Record<string, string>>,
  action: MessageKey,
  details?: HTMLElement,
): Promise<boolean> {
  const dialog = element('action-confirm', HTMLDialogElement);
  if (dialog.open) return Promise.resolve(false);
  const proceed = element('action-confirm-proceed', HTMLButtonElement),
    cancel = element('action-confirm-cancel', HTMLButtonElement),
    extra = element('action-confirm-details', HTMLDivElement);
  message(element('action-confirm-text', HTMLParagraphElement), text, params);
  message(proceed, action);
  if (details) extra.replaceChildren(details);
  extra.hidden = !details;
  return new Promise((resolve) => {
    const finish = (result: boolean) => {
      dialog.removeEventListener('close', closed);
      proceed.onclick = null;
      cancel.onclick = null;
      if (dialog.open) dialog.close();
      extra.replaceChildren();
      extra.hidden = true;
      resolve(result);
    };
    const closed = () => {
      finish(false);
    };
    proceed.onclick = () => {
      finish(true);
    };
    cancel.onclick = () => {
      finish(false);
    };
    dialog.addEventListener('close', closed);
    dialog.showModal();
    // The safe choice receives focus; the destructive action needs a deliberate click.
    cancel.focus();
  });
}

export function dismissConfirmation() {
  const dialog = element('action-confirm', HTMLDialogElement);
  if (dialog.open) dialog.close();
}

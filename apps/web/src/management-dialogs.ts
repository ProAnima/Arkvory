import { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { MessageKey } from './messages.js';
import { message, clearMessage } from './i18n.js';
import { feedback, errorKey } from './feedback.js';
import { command, field, node } from './management-dom.js';

export class ManagementDialogs {
  private readonly secretDialog = node('dialog', undefined, 'management-dialog');
  private readonly confirmation = node('dialog', undefined, 'management-dialog');
  private readonly secret = field('issued-secret', 'keySecret');
  private readonly status = node('output');
  private readonly activate: HTMLButtonElement;
  private readonly saved = field('secret-saved', 'keySaved', 'checkbox');
  private controller = new AbortController();
  private confirmed: ((result: boolean) => void) | undefined;
  private refresh: (() => void) | undefined;
  constructor(private readonly baseUrl: string) {
    this.secretDialog.id = 'key-secret-dialog';
    this.secretDialog.setAttribute('aria-labelledby', 'secret-title');
    const title = node('h2', 'keySecret');
    title.id = 'secret-title';
    this.secret.input.readOnly = true;
    this.secret.input.autocomplete = 'off';
    this.secret.input.spellcheck = false;
    this.secret.input.className = 'mono';
    this.status.setAttribute('aria-live', 'polite');
    const copy = command('keyCopy', () => {
      void this.copy();
    });
    this.activate = command('keyActivate', () => {
      void this.activation();
    });
    this.saved.input.onchange = () => {
      this.activate.disabled = !this.saved.input.checked;
    };
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      copy,
      this.activate,
      command('managementClose', () => {
        this.closeSecret();
      }),
    );
    this.secretDialog.append(
      title,
      node('p', 'keySecretHint', 'hint'),
      this.secret.label,
      this.saved.label,
      node('p', 'keyActivateHint', 'hint'),
      actions,
      this.status,
    );
    this.secretDialog.addEventListener('cancel', () => {
      this.forget();
    });
    this.secretDialog.addEventListener('close', () => {
      if (!this.secretDialog.open) this.forget();
    });
    this.confirmation.id = 'management-confirm-dialog';
    this.confirmation.setAttribute('aria-labelledby', 'management-confirm-title');
    this.confirmation.addEventListener('close', () => {
      this.confirmed?.(false);
      this.confirmed = undefined;
    });
    document.body.append(this.secretDialog, this.confirmation);
  }
  clear() {
    this.forget();
    this.secretDialog.close();
    this.confirmation.close();
    this.confirmation.replaceChildren();
  }
  private closeSecret() {
    this.forget();
    this.secretDialog.close();
  }
  private forget() {
    this.controller.abort();
    this.controller = new AbortController();
    this.secret.input.value = '';
    this.saved.input.checked = false;
    this.saved.input.disabled = false;
    this.activate.disabled = true;
    this.refresh = undefined;
    clearMessage(this.status);
  }
  showSecret(secret: string, refresh: () => void) {
    this.forget();
    this.secret.input.value = secret;
    this.refresh = refresh;
    this.secretDialog.showModal();
    this.secret.input.focus();
  }
  private async copy() {
    const signal = this.controller.signal;
    try {
      await navigator.clipboard.writeText(this.secret.input.value);
      if (!signal.aborted) message(this.status, 'keyCopied');
    } catch {
      if (!signal.aborted) {
        message(this.status, 'keyCopyFailed');
        this.secret.input.select();
      }
    }
  }
  private async activation() {
    if (this.activate.disabled || !this.secret.input.value) return;
    const owner = this.controller.signal,
      signal = AbortSignal.any([owner, AbortSignal.timeout(30_000)]),
      secret = this.secret.input.value;
    this.activate.disabled = true;
    this.saved.input.disabled = true;
    try {
      await new ArkvoryClient(this.baseUrl, () => secret).activateServiceKey(signal);
      if (owner.aborted) return;
      feedback(this.status, 'keyActivated', {}, 'success');
      this.refresh?.();
    } catch (error) {
      if (!owner.aborted) {
        feedback(this.status, errorKey(error), {}, 'error');
        this.activate.disabled = false;
      }
    } finally {
      if (!owner.aborted) this.saved.input.disabled = false;
    }
  }
  confirm(name: string, explanation: MessageKey, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const title = node('h2', 'managementConfirm');
    title.id = 'management-confirm-title';
    const target = node('strong');
    target.textContent = name;
    const typed = field('management-confirm-name', 'managementConfirmName');
    const accept = command(
      'managementConfirmSubmit',
      () => {
        if (typed.input.value !== name) return;
        this.confirmed?.(true);
        this.confirmed = undefined;
        this.confirmation.close();
      },
      'primary',
    );
    accept.disabled = true;
    typed.input.oninput = () => {
      accept.disabled = typed.input.value !== name;
    };
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      command('managementClose', () => {
        this.confirmation.close();
      }),
      accept,
    );
    this.confirmation.replaceChildren(
      title,
      node('p', explanation, 'hint'),
      target,
      typed.label,
      actions,
    );
    return new Promise((resolve) => {
      const abort = () => {
        finish(false);
        this.confirmed = undefined;
        this.confirmation.close();
      };
      const finish = (result: boolean) => {
        signal.removeEventListener('abort', abort);
        resolve(result);
      };
      this.confirmed = finish;
      signal.addEventListener('abort', abort, { once: true });
      this.confirmation.showModal();
      typed.input.focus();
    });
  }
}

import { feedback } from './feedback.js';
import type { UpdateSnapshot } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, dateMessage } from './i18n.js';
import type { MessageKey } from './messages.js';

const errors: Record<NonNullable<UpdateSnapshot['error']>, MessageKey> = {
  check_failed: 'updateCheckFailed',
  update_failed: 'updateFailed',
  conflict: 'updateConflict',
  maintenance_required: 'updateMaintenance',
  recovery_required: 'updateRecovery',
};
function newer(candidate: string, current: string) {
  const a = candidate.split('.').map(Number),
    b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Number(a[i]) > Number(b[i]);
  return false;
}
export class UpdateView {
  readonly nav = element('updates-nav', HTMLButtonElement);
  readonly banner = element('update-banner', HTMLElement);
  readonly output = element('updates-status', HTMLOutputElement);
  readonly form = element('update-settings', HTMLFormElement);
  readonly automatic = element('update-automatic', HTMLInputElement);
  readonly hour = element('update-hour', HTMLSelectElement);
  readonly check = element('update-check', HTMLButtonElement);
  readonly install = element('update-install', HTMLButtonElement);
  readonly dialog = element('update-confirm', HTMLDialogElement);
  constructor() {
    for (let h = 0; h < 24; h++) {
      const option = document.createElement('option');
      option.value = String(h);
      message(option, 'updateHourOption', { hour: String(h).padStart(2, '0') });
      this.hour.append(option);
    }
  }
  disable() {
    this.check.disabled = true;
    this.install.disabled = true;
    this.controls(true);
  }
  clear() {
    this.disable();
    this.form.reset();
    for (const id of ['update-current', 'update-latest', 'update-checked', 'update-notice']) {
      const node = element(id, HTMLElement);
      node.textContent = '—';
      delete node.dataset['date'];
      delete node.dataset['i18n'];
    }
  }
  private controls(disabled: boolean) {
    this.form
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        'input, select, button',
      )
      .forEach((node) => {
        node.disabled = disabled;
      });
  }
  render(snapshot: UpdateSnapshot | null, pending: boolean, dirty: boolean) {
    const stale = !snapshot || Date.now() - Date.parse(snapshot.heartbeatAt) > 5 * 60000;
    const working = pending || snapshot?.phase === 'updating' || snapshot?.phase === 'checking';
    this.check.disabled = stale || working;
    this.controls(stale || working);
    if (!snapshot) {
      feedback(this.output, 'updateUnavailable');
      this.banner.hidden = true;
      this.install.disabled = true;
      return;
    }
    element('update-current', HTMLElement).textContent = snapshot.currentVersion;
    element('update-latest', HTMLElement).textContent = snapshot.latest?.version ?? '—';
    const checked = element('update-checked', HTMLElement);
    if (snapshot.checkedAt) {
      delete checked.dataset['i18n'];
      dateMessage(checked, snapshot.checkedAt);
    } else {
      delete checked.dataset['date'];
      message(checked, 'updateUnknown');
    }
    if (!dirty) {
      this.automatic.checked = snapshot.automatic;
      this.hour.value = String(snapshot.hourUTC);
    }
    const available = snapshot.latest && newer(snapshot.latest.version, snapshot.currentVersion);
    this.banner.hidden = !available;
    if (available && snapshot.latest)
      message(element('update-notice', HTMLElement), 'updateAvailable', {
        version: snapshot.latest.version,
      });
    const maintenance = snapshot.latest && snapshot.latest.schema !== snapshot.currentSchema;
    this.install.disabled =
      !available || stale || working || !!snapshot.pin || !!snapshot.error || !!maintenance;
    message(
      this.output,
      snapshot.phase === 'updating'
        ? 'updateWorking'
        : stale
          ? 'updateStale'
          : pending
            ? 'updatePending'
            : snapshot.error
              ? errors[snapshot.error]
              : snapshot.phase === 'checking'
                ? 'updateChecking'
                : snapshot.pin
                  ? 'updatePinned'
                  : maintenance
                    ? 'updateMaintenance'
                    : 'updateIdle',
    );
  }
}

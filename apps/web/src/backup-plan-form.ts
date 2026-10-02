import type { BackupPlanResponse, BackupPlanUpdateRequest } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { UiError } from './feedback.js';
import { clearFieldErrors } from './field-errors.js';
import type { FieldMap } from './field-errors.js';
import { clearMessage, message } from './i18n.js';
import { browserZone, formatTime, parseTime, timeZones, zoneOffset } from './backup-model.js';

/** Request fields of PUT /backup/plan (JSON Pointers, ADR 0051) → inputs that edit them. */
export const planFields: FieldMap = {
  '/enabled': 'backup-enabled',
  '/hour': 'backup-time',
  '/minute': 'backup-time',
  '/timezone': 'backup-timezone',
  '/retention': 'backup-daily',
  '/retention/daily': 'backup-daily',
  '/retention/weekly': 'backup-weekly',
  '/retention/monthly': 'backup-monthly',
};

/**
 * The plan form. A plan read in the background never replaces what the person is editing, and
 * the browser time zone is only offered: a saved plan keeps its explicit zone until changed.
 */
export class BackupPlanForm {
  readonly form = element('backup-plan', HTMLFormElement);
  readonly output = element('backup-plan-status', HTMLOutputElement);
  private readonly fields = element('backup-plan-fields', HTMLFieldSetElement);
  private readonly enabled = element('backup-enabled', HTMLInputElement);
  private readonly time = element('backup-time', HTMLInputElement);
  private readonly zone = element('backup-timezone', HTMLInputElement);
  private readonly zones = element('backup-zones', HTMLDataListElement);
  private readonly offset = element('backup-zone-offset', HTMLOutputElement);
  private readonly browser = element('backup-zone-browser', HTMLButtonElement);
  private readonly readOnly = element('backup-read-only', HTMLParagraphElement);
  private readonly retention = {
    daily: element('backup-daily', HTMLInputElement),
    weekly: element('backup-weekly', HTMLInputElement),
    monthly: element('backup-monthly', HTMLInputElement),
  };
  private revision: number | undefined;
  private dirty = false;

  constructor() {
    this.form.addEventListener('input', () => {
      this.dirty = true;
    });
    this.zone.addEventListener('input', () => {
      this.describeZone();
    });
    this.browser.onclick = () => {
      this.zone.value = browserZone();
      this.zone.dispatchEvent(new Event('input', { bubbles: true }));
      this.zone.focus();
    };
  }

  /** The datalist is filled once, on first use: several hundred zones are not built on load. */
  loadZones() {
    if (this.zones.options.length) return;
    this.zones.replaceChildren(
      ...timeZones().map((zone) => {
        const option = document.createElement('option');
        option.value = zone;
        return option;
      }),
    );
  }

  fill(plan: BackupPlanResponse) {
    this.enabled.checked = plan.enabled;
    this.time.value = formatTime(plan.hour, plan.minute);
    this.zone.value = plan.timezone;
    this.retention.daily.value = String(plan.retention.daily);
    this.retention.weekly.value = String(plan.retention.weekly);
    this.retention.monthly.value = String(plan.retention.monthly);
    this.revision = plan.revision;
    this.dirty = false;
    clearFieldErrors(planFields);
    this.describeZone();
  }

  /** Applies a freshly read plan unless the person has unsaved edits. */
  offer(plan: BackupPlanResponse) {
    if (!this.dirty || this.revision === undefined) this.fill(plan);
  }

  /** The update for CAS against the revision this form was filled from. */
  read(): BackupPlanUpdateRequest {
    const time = parseTime(this.time.value);
    if (!time || this.revision === undefined)
      throw new UiError('errorFields', [{ field: '/hour', problem: 'format' }]);
    return {
      expectedRevision: this.revision,
      enabled: this.enabled.checked,
      hour: time.hour,
      minute: time.minute,
      // The server validates the name with its own zone database; the browser only suggests.
      timezone: this.zone.value.trim(),
      retention: {
        daily: Number(this.retention.daily.value),
        weekly: Number(this.retention.weekly.value),
        monthly: Number(this.retention.monthly.value),
      },
    };
  }

  editable(allowed: boolean) {
    this.fields.disabled = !allowed;
    this.readOnly.hidden = allowed;
    this.describeZone();
  }

  private describeZone() {
    const zone = this.zone.value.trim();
    const offset = zone ? zoneOffset(zone, Date.now()) : null;
    if (!zone) clearMessage(this.offset);
    else if (offset) message(this.offset, 'backupZoneOffset', { offset });
    else message(this.offset, 'backupZoneUnknown');
    const suggested = browserZone();
    this.browser.hidden = this.fields.disabled || suggested === zone;
    message(this.browser, 'backupZoneBrowser', { zone: suggested });
  }

  clear() {
    this.form.reset();
    this.revision = undefined;
    this.dirty = false;
    clearFieldErrors(planFields);
    clearMessage(this.output);
    clearMessage(this.offset);
    this.editable(false);
  }
}

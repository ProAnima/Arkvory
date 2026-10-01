import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { readStoragePolicy } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { UiError } from './feedback.js';
import { quotaBytes, quotaGib } from './storage-quota.js';

type Policy = Awaited<ReturnType<ArkvoryClient['storagePolicy']>>['policy'];

const input = (id: string) => element(`storage-${id}`, HTMLInputElement);
const list = (value: string, separator: string) =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

function channelOverrides(value: string) {
  return list(value, '\n').map((line) => {
    const [label, count, ...extra] = line.split('=');
    if (extra.length || !count?.trim()) throw new Error('Invalid channel');
    return { label, keepLast: Number(count) };
  });
}

/** Retention form state. Quotas are edited in GiB and exchanged with the API as exact bytes. */
export function installStorageForm() {
  const grouping = element('storage-grouping', HTMLSelectElement),
    channels = element('storage-channels', HTMLTextAreaElement);
  // An untouched quota field keeps the stored byte value instead of its rounded GiB display.
  let loaded: { text: string; bytes: string | null } = { text: '', bytes: null };
  const channelVisibility = () => {
    const label = channels.closest('label');
    if (label) label.hidden = grouping.value !== 'package-channel';
  };
  grouping.addEventListener('change', channelVisibility);
  const quota = () => {
    const text = input('quota').value.trim();
    if (text === loaded.text) return loaded.bytes;
    try {
      return quotaBytes(text);
    } catch {
      throw new UiError('storageQuotaInvalid');
    }
  };
  return {
    enabled: () => input('enabled').checked,
    fill(policy: Policy) {
      input('enabled').checked = policy.enabled;
      grouping.value = policy.grouping;
      channelVisibility();
      loaded = {
        text: policy.quotaBytes === null ? '' : quotaGib(policy.quotaBytes),
        bytes: policy.quotaBytes,
      };
      for (const [id, value] of Object.entries({
        keep: policy.keepLast,
        age: policy.minAgeHours,
        interval: policy.intervalMinutes,
        quota: loaded.text,
        warning: policy.warningPercent,
        critical: policy.criticalPercent,
        protected: policy.protectedLabels.join(', '),
      }))
        input(id).value = String(value);
      channels.value = policy.channels.map((c) => `${c.label}=${String(c.keepLast)}`).join('\n');
    },
    read() {
      const quotaValue = quota();
      try {
        return readStoragePolicy({
          enabled: input('enabled').checked,
          grouping: grouping.value,
          keepLast: Number(input('keep').value),
          minAgeHours: Number(input('age').value),
          intervalMinutes: Number(input('interval').value),
          quotaBytes: quotaValue,
          warningPercent: Number(input('warning').value),
          criticalPercent: Number(input('critical').value),
          protectedLabels: list(input('protected').value, ','),
          channels: channelOverrides(channels.value),
        });
      } catch {
        throw new UiError('errorInput');
      }
    },
    reset() {
      loaded = { text: '', bytes: null };
    },
  };
}

import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { dateMessage, message } from './i18n.js';

type Usage = Awaited<ReturnType<ArkvoryClient['storageUsage']>>;
type Events = Awaited<ReturnType<ArkvoryClient['storageEvents']>>['items'];
type Preview = Awaited<ReturnType<ArkvoryClient['previewStoragePolicy']>>['items'];

/** Usage is shown in binary units; exact byte counts stay in data attributes for RU/EN. */
export function showUsage(usage: HTMLElement, capacity: HTMLElement, totals: Usage) {
  const sizes = {
    published: totals.publishedBytes,
    pending: totals.pendingBytes,
    retired: totals.retiredBytes,
    total: totals.reservedBytes,
  };
  if (totals.quotaBytes === null)
    message(usage, 'storageUsageUnlimited', sizes, Object.keys(sizes));
  else
    message(usage, 'storageUsage', { ...sizes, quota: totals.quotaBytes }, [
      ...Object.keys(sizes),
      'quota',
    ]);
  message(
    capacity,
    totals.state === 'critical' || totals.state === 'exceeded'
      ? 'storageCritical'
      : totals.state === 'warning'
        ? 'storageWarning'
        : 'storageNormal',
  );
}

export function appendEvents(list: HTMLUListElement, items: Events) {
  for (const event of items) {
    const item = document.createElement('li'),
      time = document.createElement('span'),
      code = document.createElement('span'),
      details = document.createElement('pre');
    dateMessage(time, event.occurredAt);
    message(code, 'storageEventCode', { level: event.level, code: event.code });
    details.className = 'mono';
    details.textContent = JSON.stringify(event.details, null, 2);
    item.append(time, ' ', code, details);
    list.append(item);
  }
  // Bound DOM memory even when browsing the full diagnostic history.
  while (list.childElementCount > 300) list.firstElementChild?.remove();
}

export function showPreview(list: HTMLUListElement, items: Preview) {
  list.replaceChildren(
    ...items.map((candidate) => {
      const item = document.createElement('li');
      message(
        item,
        'storagePreviewItem',
        { name: candidate.name, id: candidate.id, size: candidate.size },
        ['size'],
      );
      return item;
    }),
  );
}

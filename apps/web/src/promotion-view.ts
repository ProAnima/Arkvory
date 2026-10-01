import type { PromotionEventResponse, StageResponse } from '@proanima/arkvory-contracts';
import { dateMessage, message, t } from './i18n.js';
import type { MessageKey } from './messages.js';

const eventKeys: Record<string, MessageKey> = {
  'stage.added': 'eventStageAdded',
  'stage.removed': 'eventStageRemoved',
  'promoted.copy': 'eventPromotedCopy',
  'promoted.move': 'eventPromotedMove',
  'received.copy': 'eventReceivedCopy',
  'received.move': 'eventReceivedMove',
};

export function stageChip(
  entry: StageResponse,
  removable: boolean,
  remove: (entry: StageResponse) => void,
): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'stage-chip';
  const name = document.createElement('span');
  name.textContent = entry.stage;
  if (entry.comment) item.title = entry.comment;
  item.append(name);
  if (removable) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost small stage-remove';
    button.textContent = '×';
    button.setAttribute('aria-label', t('stageRemove', { stage: entry.stage }));
    button.onclick = () => {
      remove(entry);
    };
    item.append(button);
  }
  return item;
}

export function historyItem(event: PromotionEventResponse): HTMLLIElement {
  const item = document.createElement('li');
  const when = document.createElement('time');
  when.dateTime = event.occurredAt;
  dateMessage(when, event.occurredAt);
  const text = document.createElement('span');
  const key =
    event.action === 'stage.added' || event.action === 'stage.removed'
      ? event.action
      : `${event.action}.${event.mode ?? 'copy'}`;
  message(text, eventKeys[key] ?? 'eventStageAdded', {
    actor: event.actor,
    stage: event.stage ?? '',
    repository: event.peerRepository ?? '',
  });
  item.append(when, text);
  if (event.comment) {
    const note = document.createElement('q');
    note.textContent = event.comment;
    item.append(note);
  }
  return item;
}

export function historyPlaceholder(): HTMLLIElement {
  const item = document.createElement('li');
  message(item, 'promotionHistoryEmpty');
  return item;
}

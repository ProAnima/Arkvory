import type { ArtifactSearchItemResponse } from '@proanima/arkvory-contracts';
import { bytesMessage, dateMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';

export interface ArtifactRowActions {
  readonly open: () => void;
  readonly download: () => void;
}

function hiddenLabel(key: MessageKey): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = 'sr-only';
  message(label, key);
  return label;
}

function fact(key: MessageKey, value: HTMLElement): HTMLSpanElement {
  const wrapper = document.createElement('span');
  wrapper.append(hiddenLabel(key), value);
  return wrapper;
}

function facts(item: ArtifactSearchItemResponse): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'artifact-facts';
  const size = document.createElement('span');
  bytesMessage(size, item.size);
  line.append(fact('catalogSizeLabel', size));
  if (item.publishedAt) {
    const published = document.createElement('time');
    published.dateTime = item.publishedAt;
    dateMessage(published, item.publishedAt);
    line.append(fact('catalogPublishedLabel', published));
  }
  return line;
}

/** Stages come first and use the promotion chip; labels stay neutral. Empty groups are omitted. */
function tags(item: ArtifactSearchItemResponse): HTMLSpanElement | null {
  if (!item.stages.length && !item.labels.length) return null;
  const line = document.createElement('span');
  line.className = 'artifact-tags';
  for (const [key, values, className] of [
    ['stagesTitle', item.stages, 'badge artifact-stage'],
    ['labels', item.labels, 'badge'],
  ] as const) {
    if (!values.length) continue;
    line.append(hiddenLabel(key));
    for (const value of values) {
      const chip = document.createElement('span');
      chip.className = className;
      chip.textContent = value;
      line.append(chip);
    }
  }
  return line;
}

function actionButton(key: MessageKey, describedBy: string, action: () => void) {
  const button = document.createElement('button');
  message(button, key);
  button.type = 'button';
  button.className = 'secondary small';
  button.setAttribute('aria-describedby', describedBy);
  button.onclick = action;
  return button;
}

export function artifactRow(
  item: ArtifactSearchItemResponse,
  actions: ArtifactRowActions,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  const name = document.createElement('td');
  const filename = document.createElement('span');
  filename.textContent = item.name;
  filename.className = 'artifact-name';
  filename.id = `artifact-name-${item.id}`;
  const id = document.createElement('span');
  id.textContent = item.id;
  id.className = 'artifact-id';
  const labels = tags(item);
  name.append(filename, facts(item), ...(labels ? [labels] : []), id);
  const controls = document.createElement('div');
  controls.className = 'catalog-actions';
  controls.append(
    actionButton('open', filename.id, actions.open),
    actionButton('download', filename.id, actions.download),
  );
  const cell = document.createElement('td');
  cell.append(controls);
  row.append(name, cell);
  return row;
}

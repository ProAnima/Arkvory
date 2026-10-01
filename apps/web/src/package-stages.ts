import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { PackageResponse } from '@proanima/arkvory-contracts';
import { message } from './i18n.js';

export function packageRow(item: PackageResponse, open: () => void): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (const value of [item.group, item.name, item.version]) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  const stages = document.createElement('td');
  stages.className = 'package-stages';
  stages.dataset['artifactId'] = item.artifactId;
  const action = document.createElement('td');
  const button = document.createElement('button');
  button.className = 'secondary small';
  message(button, 'open');
  button.onclick = open;
  action.append(button);
  row.append(stages, action);
  return row;
}

/** One request per 100 rows; without artifact.list the column simply stays empty. */
export async function decorateStages(
  client: ArkvoryClient,
  repository: string,
  rows: HTMLTableSectionElement,
): Promise<void> {
  const cells = [...rows.querySelectorAll<HTMLTableCellElement>('td.package-stages')];
  for (let start = 0; start < cells.length; start += 100) {
    const chunk = cells.slice(start, start + 100);
    const ids = chunk.map((cell) => cell.dataset['artifactId'] ?? '').filter(Boolean);
    if (!ids.length) continue;
    const byArtifact = new Map<string, string[]>();
    let after: string | undefined;
    do {
      const page = await client.promotions.staged(repository, { ids, ...(after ? { after } : {}) });
      for (const entry of page.items)
        byArtifact.set(entry.artifactId, [
          ...(byArtifact.get(entry.artifactId) ?? []),
          entry.stage,
        ]);
      after = page.next ?? undefined;
    } while (after);
    for (const cell of chunk) {
      const list = document.createElement('div');
      list.className = 'package-stage-list';
      for (const stage of byArtifact.get(cell.dataset['artifactId'] ?? '') ?? []) {
        const chip = document.createElement('span');
        chip.className = 'badge stage-badge';
        chip.textContent = stage;
        list.append(chip);
      }
      cell.replaceChildren(list);
    }
  }
}

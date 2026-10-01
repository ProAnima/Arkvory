import type { ArkvoryClient, PromoteRequest } from '@proanima/arkvory-sdk';
import type { PromotionEventPageResponse, StageResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, t } from './i18n.js';
import { feedback, UiError } from './feedback.js';
import { historyItem, historyPlaceholder, stageChip } from './promotion-view.js';
import type { MessageKey } from './messages.js';

interface Selection {
  readonly repository: string;
  readonly id: string;
  readonly canStage: boolean;
  readonly canPromote: boolean;
}
const stagePattern = /^[a-z0-9][a-z0-9_.-]{0,31}$/;

function dom() {
  return {
    panel: element('promotion-panel', HTMLElement),
    list: element('stage-list', HTMLUListElement),
    empty: element('stage-empty', HTMLParagraphElement),
    stageForm: element('stage-form', HTMLFormElement),
    stageName: element('stage-name', HTMLInputElement),
    stageComment: element('stage-comment', HTMLInputElement),
    promoteForm: element('promote-form', HTMLFormElement),
    target: element('promote-target', HTMLSelectElement),
    move: element('promote-move', HTMLInputElement),
    stages: element('promote-stages', HTMLInputElement),
    comment: element('promote-comment', HTMLInputElement),
    status: element('promotion-status', HTMLOutputElement),
    history: element('promotion-history', HTMLOListElement),
    more: element('promotion-more', HTMLButtonElement),
  };
}
type Dom = ReturnType<typeof dom>;

/** Repositories where the caller may promote, excluding the source. */
async function promotionTargets(client: ArkvoryClient, source: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const page = await client.repositories(after ? { after } : {});
    for (const card of page.items)
      if (card.id !== source && card.permissions.includes('artifact.promote')) ids.push(card.id);
    after = page.next ?? undefined;
  } while (after && ids.length < 500);
  return ids;
}

function promoteRequest(view: Dom): PromoteRequest {
  const stages = view.stages.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (stages.some((value) => !stagePattern.test(value))) throw new UiError('stageInvalid');
  return {
    target: view.target.value,
    mode: view.move.checked ? 'move' : 'copy',
    stages,
    ...(view.comment.value ? { comment: view.comment.value } : {}),
  };
}

function renderHistory(view: Dom, page: PromotionEventPageResponse, append: boolean) {
  if (!append) view.history.replaceChildren();
  view.history.append(...page.items.map(historyItem));
  if (!view.history.children.length) view.history.append(historyPlaceholder());
  view.more.hidden = page.next === null;
}

async function addStage(view: Dom, client: ArkvoryClient, s: Selection): Promise<string> {
  const name = view.stageName.value.trim();
  if (!stagePattern.test(name)) throw new UiError('stageInvalid');
  await client.promotions.setStage(s.repository, s.id, name, view.stageComment.value || undefined);
  view.stageName.value = view.stageComment.value = '';
  return name;
}

/** Returns null when the operator declines the move confirmation. */
async function promote(view: Dom, client: ArkvoryClient, s: Selection) {
  const request = promoteRequest(view);
  const moved = request.mode === 'move';
  if (moved && !confirm(t('promoteMoveConfirm', { repository: request.target }))) return null;
  const result = await client.promotions.promote(s.repository, s.id, request);
  view.stages.value = view.comment.value = '';
  view.move.checked = false;
  const key: MessageKey = moved
    ? 'promoteMoved'
    : result.created
      ? 'promoteDone'
      : 'promoteExisting';
  return { moved, key, repository: result.repository };
}

/** Stage chips, promotion form and history for the selected artifact. */
export function installPromotionPanel(
  client: ArkvoryClient,
  run: (action: () => Promise<void>) => void,
  onMoved: (repository: string) => void,
) {
  const view = dom();
  let selection: Selection | undefined;
  let cursor: string | null = null;
  const current = () => {
    if (!selection) throw new UiError('selectArtifact');
    return selection;
  };
  const removeStage = (entry: StageResponse) => {
    if (!confirm(t('stageRemoveConfirm', { stage: entry.stage }))) return;
    run(async () => {
      const s = current();
      await client.promotions.removeStage(s.repository, s.id, entry.stage);
      feedback(view.status, 'stageRemoved', { stage: entry.stage });
      await refresh(s);
    });
  };
  async function refresh(s: Selection) {
    const stages = await client.promotions.stages(s.repository, s.id);
    if (s !== selection) return;
    view.list.replaceChildren(...stages.map((e) => stageChip(e, s.canStage, removeStage)));
    view.empty.hidden = stages.length > 0;
    await loadHistory(s, false);
  }
  async function loadHistory(s: Selection, append: boolean) {
    const options = append && cursor ? { after: cursor } : {};
    const page = await client.promotions.history(s.repository, s.id, options);
    if (s !== selection) return;
    cursor = page.next;
    renderHistory(view, page, append);
  }
  view.stageForm.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const s = current();
      const name = await addStage(view, client, s);
      feedback(view.status, 'stageAdded', { stage: name });
      await refresh(s);
    });
  };
  view.promoteForm.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const s = current();
      const outcome = await promote(view, client, s);
      if (!outcome) return;
      feedback(view.status, outcome.key, { repository: outcome.repository }, 'success');
      if (outcome.moved) onMoved(s.repository);
      else await refresh(s);
    });
  };
  view.more.onclick = () => {
    run(() => loadHistory(current(), true));
  };
  return {
    open(repository: string, id: string, operations: ReadonlySet<string>) {
      const s: Selection = {
        repository,
        id,
        canStage: operations.has('setArtifactStage'),
        canPromote: operations.has('promoteArtifact'),
      };
      selection = s;
      view.panel.hidden = !operations.has('listArtifactStages');
      view.stageForm.hidden = !s.canStage;
      view.promoteForm.hidden = true;
      clearMessage(view.status);
      if (view.panel.hidden) return;
      run(async () => {
        await refresh(s);
        const targets = s.canPromote ? await promotionTargets(client, repository) : [];
        if (s !== selection) return;
        view.target.replaceChildren(...targets.map((target) => new Option(target, target)));
        view.promoteForm.hidden = targets.length === 0;
        if (s.canPromote && targets.length === 0) feedback(view.status, 'promoteNoTargets');
      });
    },
    clear() {
      selection = undefined;
      cursor = null;
      view.panel.hidden = true;
      view.list.replaceChildren();
      view.history.replaceChildren();
      view.target.replaceChildren();
      clearMessage(view.status);
    },
  };
}

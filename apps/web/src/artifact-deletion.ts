import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { DeletionCandidateResponse } from '@proanima/arkvory-contracts';
import type { MessageKey } from './messages.js';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback, errorKey } from './feedback.js';

const blockerMessages: Record<DeletionCandidateResponse['blockers'][number], MessageKey> = {
  reference: 'deletionReference',
  asset_history: 'deletionAsset',
  attachment_history: 'deletionAttachment',
  protected_label: 'deletionLabel',
  promotion_stage: 'deletionStage',
};
// arkvory-exception ARCH-021 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installArtifactDeletion(client: ArkvoryClient, deleted: () => Promise<void>) {
  const section = element('artifact-deletion', HTMLDetailsElement),
    inspect = element('deletion-inspect', HTMLButtonElement),
    confirm = element('deletion-confirm', HTMLInputElement),
    submit = element('deletion-submit', HTMLButtonElement),
    form = element('deletion-form', HTMLFormElement),
    status = element('deletion-status', HTMLOutputElement),
    reasons = element('deletion-reasons', HTMLUListElement);
  let selected: { repository: string; id: string } | undefined;
  let candidate: DeletionCandidateResponse | undefined;
  let generation = 0;
  let stop: AbortController | undefined;
  let busy = false;
  const update = () => {
    inspect.disabled = busy;
    confirm.disabled = busy || !candidate || candidate.blockers.length > 0;
    submit.disabled = confirm.disabled || confirm.value !== selected?.id;
  };
  const clear = () => {
    generation++;
    stop?.abort();
    stop = undefined;
    busy = false;
    selected = undefined;
    candidate = undefined;
    section.hidden = true;
    section.open = false;
    confirm.value = '';
    form.hidden = true;
    reasons.replaceChildren();
    clearMessage(status);
    update();
  };
  confirm.oninput = update;
  inspect.onclick = () => {
    if (!selected || busy) return;
    const current = selected,
      version = generation;
    stop = new AbortController();
    busy = true;
    candidate = undefined;
    form.hidden = true;
    confirm.value = '';
    reasons.replaceChildren();
    feedback(status, 'deletionChecking');
    update();
    void client
      .inspectDeletion(current.repository, current.id, stop.signal)
      .then((result) => {
        if (version !== generation) return;
        candidate = result;
        for (const reason of result.blockers) {
          const row = document.createElement('li');
          message(row, blockerMessages[reason]);
          reasons.append(row);
        }
        form.hidden = result.blockers.length > 0;
        feedback(status, result.blockers.length ? 'deletionBlocked' : 'deletionReady');
      })
      .catch((error: unknown) => {
        if (version === generation) feedback(status, errorKey(error), {}, 'error');
      })
      .finally(() => {
        if (version === generation) {
          busy = false;
          update();
          if (candidate && !candidate.blockers.length) confirm.focus();
        }
      });
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!selected || !candidate || submit.disabled || busy) return;
    const current = selected,
      version = generation,
      revision = candidate.annotationRevision;
    busy = true;
    update();
    void client
      .deleteArtifact(current.repository, current.id, revision, stop?.signal)
      .then(async (result) => {
        if (version !== generation) return;
        if (result.outcome === 'deleted' || result.outcome === 'already_deleted') {
          clear();
          await deleted();
        } else {
          candidate = undefined;
          form.hidden = true;
          feedback(status, 'deletionRecheck', {}, 'error');
        }
      })
      .catch((error: unknown) => {
        if (version === generation) feedback(status, errorKey(error), {}, 'error');
      })
      .finally(() => {
        if (version === generation) {
          busy = false;
          update();
        }
      });
  };
  clear();
  return {
    clear,
    open(repository: string, id: string, allowed: boolean) {
      clear();
      if (allowed) {
        selected = { repository, id };
        section.hidden = false;
        update();
      }
    },
  };
}

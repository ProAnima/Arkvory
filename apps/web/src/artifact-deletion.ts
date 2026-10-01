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

function deletionElements() {
  return {
    section: element('artifact-deletion', HTMLDetailsElement),
    inspect: element('deletion-inspect', HTMLButtonElement),
    confirm: element('deletion-confirm', HTMLInputElement),
    submit: element('deletion-submit', HTMLButtonElement),
    form: element('deletion-form', HTMLFormElement),
    status: element('deletion-status', HTMLOutputElement),
    reasons: element('deletion-reasons', HTMLUListElement),
  };
}

interface DeletionState {
  selected: { repository: string; id: string } | undefined;
  candidate: DeletionCandidateResponse | undefined;
  generation: number;
  stop: AbortController | undefined;
  busy: boolean;
}
type Ui = ReturnType<typeof deletionElements>;

function update(ui: Ui, state: DeletionState) {
  ui.inspect.disabled = state.busy;
  ui.confirm.disabled = state.busy || !state.candidate || state.candidate.blockers.length > 0;
  ui.submit.disabled = ui.confirm.disabled || ui.confirm.value !== state.selected?.id;
}

/**
 * Runs one deletion request for the current selection. Late results of a cleared or changed
 * selection are ignored, and the busy flag is released only by the request that set it.
 */
function request<T>(
  ui: Ui,
  state: DeletionState,
  call: (current: { repository: string; id: string }) => Promise<T>,
  done: (result: T) => Promise<void> | void,
  settled: () => void = () => undefined,
) {
  const current = state.selected;
  if (!current) return;
  const version = state.generation;
  state.busy = true;
  update(ui, state);
  void call(current)
    .then(async (result) => {
      if (version === state.generation) await done(result);
    })
    .catch((error: unknown) => {
      if (version === state.generation) feedback(ui.status, errorKey(error), {}, 'error');
    })
    .finally(() => {
      if (version === state.generation) {
        state.busy = false;
        update(ui, state);
        settled();
      }
    });
}

function showCandidate(ui: Ui, state: DeletionState, result: DeletionCandidateResponse) {
  state.candidate = result;
  for (const reason of result.blockers) {
    const row = document.createElement('li');
    message(row, blockerMessages[reason]);
    ui.reasons.append(row);
  }
  ui.form.hidden = result.blockers.length > 0;
  feedback(ui.status, result.blockers.length ? 'deletionBlocked' : 'deletionReady');
}

export function installArtifactDeletion(client: ArkvoryClient, deleted: () => Promise<void>) {
  const ui = deletionElements();
  const state: DeletionState = {
    selected: undefined,
    candidate: undefined,
    generation: 0,
    stop: undefined,
    busy: false,
  };
  const clear = () => {
    state.generation++;
    state.stop?.abort();
    Object.assign(state, {
      stop: undefined,
      busy: false,
      selected: undefined,
      candidate: undefined,
    });
    ui.section.hidden = true;
    ui.section.open = false;
    ui.confirm.value = '';
    ui.form.hidden = true;
    ui.reasons.replaceChildren();
    clearMessage(ui.status);
    update(ui, state);
  };
  ui.confirm.oninput = () => {
    update(ui, state);
  };
  ui.inspect.onclick = () => {
    if (!state.selected || state.busy) return;
    const stop = new AbortController();
    state.stop = stop;
    state.candidate = undefined;
    ui.form.hidden = true;
    ui.confirm.value = '';
    ui.reasons.replaceChildren();
    feedback(ui.status, 'deletionChecking');
    request(
      ui,
      state,
      (current) => client.inspectDeletion(current.repository, current.id, stop.signal),
      (result) => {
        showCandidate(ui, state, result);
      },
      () => {
        if (state.candidate && !state.candidate.blockers.length) ui.confirm.focus();
      },
    );
  };
  ui.form.onsubmit = (event) => {
    event.preventDefault();
    const candidate = state.candidate;
    if (!state.selected || !candidate || ui.submit.disabled || state.busy) return;
    request(
      ui,
      state,
      (current) =>
        client.deleteArtifact(
          current.repository,
          current.id,
          candidate.annotationRevision,
          state.stop?.signal,
        ),
      async (result) => {
        if (result.outcome === 'deleted' || result.outcome === 'already_deleted') {
          clear();
          await deleted();
        } else {
          state.candidate = undefined;
          ui.form.hidden = true;
          feedback(ui.status, 'deletionRecheck', {}, 'error');
        }
      },
    );
  };
  clear();
  return {
    clear,
    open(repository: string, id: string, allowed: boolean) {
      clear();
      if (allowed) {
        state.selected = { repository, id };
        ui.section.hidden = false;
        update(ui, state);
      }
    },
  };
}

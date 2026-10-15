import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';
import { hostOf, mirrorState, stageList } from './mirror-presentation.js';
import { mirrorReasonView } from './mirror-reason.js';

/** The badge follows the server's synchronization without a reload. */
const REFRESH_MS = 20000;

/**
 * Badge of a mirrored repository (ADR 0058) above the catalog, with its source and last
 * synchronization in the help tooltip and, while it is stopped, the reason and next step in
 * view. Nothing is shown for an ordinary repository (404) or without the right to see it; write
 * actions are hidden by operation discovery already.
 */
export function installMirrorStatus(client: ArkvoryClient) {
  const container = element('mirror-state', HTMLDivElement),
    badge = element('mirror-badge', HTMLSpanElement),
    source = element('mirror-source', HTMLSpanElement),
    synced = element('mirror-synced', HTMLSpanElement),
    problem = element('mirror-problem', HTMLDivElement);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The root flag hides upload actions in CSS; views toggle their own visibility independently.
  const mirrored = (value: boolean) => {
    document.documentElement.dataset['mirror'] = String(value);
  };
  const clear = () => {
    generation++;
    clearTimeout(timer);
    container.hidden = true;
    problem.hidden = true;
    problem.replaceChildren();
    delete problem.dataset['code'];
    mirrored(false);
  };
  const render = (status: RepositoryMirrorResponse) => {
    const state = mirrorState(status);
    const failing = state === 'failing';
    const importing = status.mode === 'import';
    container.dataset['state'] = state;
    const upstream = hostOf(status.upstream);
    if (importing) {
      // An import target is an ordinary repository: its own uploads stay possible.
      message(badge, failing ? 'mirrorImportFailing' : 'mirrorImport');
      message(source, 'mirrorImportDetails', {
        stages: stageList(status.stages),
        source: status.sourceRepository,
        upstream,
      });
    } else {
      message(
        badge,
        failing ? 'mirrorFailing' : state === 'synced' ? 'mirrorBadge' : 'mirrorBehind',
      );
      message(source, 'mirrorDetails', { source: status.sourceRepository, upstream });
    }
    if (status.syncedAt) relativeMessage(synced, status.syncedAt);
    else message(synced, 'mirrorNever');
    // A live region: rebuilt, and so announced again, only when the reason changes.
    const code = status.errorCode ?? '';
    if (problem.dataset['code'] !== code) {
      problem.dataset['code'] = code;
      const reason = mirrorReasonView(status);
      problem.replaceChildren(...(reason ? [reason] : []));
    }
    problem.hidden = status.errorCode === null;
    container.hidden = false;
    mirrored(!importing);
  };
  const poll = async (repository: string, current: number) => {
    let failure: unknown = null;
    try {
      const status = await client.repositoryMirror(repository);
      if (current !== generation) return;
      render(status);
    } catch (error) {
      if (current !== generation) return;
      // An ordinary repository or a hidden one: no badge, and nothing to follow.
      if (error instanceof ArkvoryHttpError && [403, 404].includes(error.status)) {
        clear();
        return;
      }
      // A failed refresh keeps the last state; the first read surfaces its failure.
      if (container.hidden) failure = error;
    }
    // Also after a failed first read: a mirror must not stay unmarked, with uploads offered.
    timer = setTimeout(() => {
      void poll(repository, current).catch(() => undefined);
    }, REFRESH_MS);
    if (failure !== null) throw failure;
  };
  let shown = '';
  return {
    clear() {
      shown = '';
      clear();
    },
    async connect(repository: string) {
      // The same repository again (a search reconnects it): the badge stays as it is and only
      // its polling starts over, so the stop reason is not announced once more.
      if (repository === shown && !container.hidden) {
        generation++;
        clearTimeout(timer);
      } else clear();
      shown = repository;
      await poll(repository, generation);
    },
  };
}

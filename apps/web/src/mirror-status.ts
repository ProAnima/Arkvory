import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';
import { hostOf, mirrorState } from './mirror-presentation.js';
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
        stages: status.stages.join(', '),
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
    const reason = mirrorReasonView(status);
    problem.replaceChildren(...(reason ? [reason] : []));
    problem.hidden = reason === null;
    container.hidden = false;
    mirrored(!importing);
  };
  const poll = async (repository: string, current: number) => {
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
      if (container.hidden) throw error;
    }
    timer = setTimeout(() => {
      void poll(repository, current).catch(() => undefined);
    }, REFRESH_MS);
  };
  return {
    clear,
    async connect(repository: string) {
      clear();
      await poll(repository, generation);
    },
  };
}

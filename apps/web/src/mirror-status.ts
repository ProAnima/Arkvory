import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage } from './i18n.js';

/** 'synced' | 'behind' | 'failing' | 'pending': the badge text and its color follow it. */
function stateOf(status: RepositoryMirrorResponse): string {
  if (status.errorCode !== null) return 'failing';
  if (status.phase === 'pending') return 'pending';
  return status.caughtUp === true ? 'synced' : 'behind';
}

/**
 * Badge of a mirrored repository (ADR 0058) above the catalog, with its source and last
 * synchronization in the help tooltip. Nothing is shown for an ordinary repository (404) or
 * without the right to see it; write actions are hidden by operation discovery already.
 */
export function installMirrorStatus(client: ArkvoryClient) {
  const container = element('mirror-state', HTMLDivElement),
    badge = element('mirror-badge', HTMLSpanElement),
    source = element('mirror-source', HTMLSpanElement),
    synced = element('mirror-synced', HTMLSpanElement),
    failure = element('mirror-error', HTMLSpanElement);
  let generation = 0;
  // The root flag hides upload actions in CSS; views toggle their own visibility independently.
  const mirrored = (value: boolean) => {
    document.documentElement.dataset['mirror'] = String(value);
  };
  const clear = () => {
    generation++;
    container.hidden = true;
    mirrored(false);
  };
  const render = (status: RepositoryMirrorResponse) => {
    const state = stateOf(status);
    container.dataset['state'] = state;
    message(
      badge,
      state === 'failing' ? 'mirrorFailing' : state === 'synced' ? 'mirrorBadge' : 'mirrorBehind',
    );
    message(source, 'mirrorDetails', {
      source: status.sourceRepository,
      upstream: new URL(status.upstream).host,
    });
    if (status.syncedAt) relativeMessage(synced, status.syncedAt);
    else message(synced, 'mirrorNever');
    failure.hidden = status.errorCode === null;
    if (status.errorCode !== null) message(failure, 'mirrorError', { code: status.errorCode });
    container.hidden = false;
    mirrored(true);
  };
  return {
    clear,
    async connect(repository: string) {
      clear();
      const current = generation;
      try {
        const status = await client.repositoryMirror(repository);
        if (current === generation) render(status);
      } catch (error) {
        // An ordinary repository or a hidden one: no badge. Anything else must surface.
        if (error instanceof ArkvoryHttpError && [403, 404].includes(error.status)) return;
        throw error;
      }
    },
  };
}

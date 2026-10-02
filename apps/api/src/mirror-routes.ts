import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MirrorStatus, MirrorStatusEntry } from '@proanima/arkvory-application';
import type { Principal } from '@proanima/arkvory-domain';
import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';

/** Wire form of a mirror status: `pending` until the worker's first step (ADR 0058). */
export function mirrorResponse(entry: MirrorStatusEntry): RepositoryMirrorResponse {
  const { repository, upstream, sourceRepository, state } = entry;
  return {
    repository,
    upstream,
    sourceRepository,
    phase: state?.phase ?? 'pending',
    seedStep: state?.seedStep ?? null,
    cursor: state?.cursor ?? '0',
    head: state?.head ?? null,
    caughtUp:
      state?.phase === 'following' && state.head !== null ? state.cursor === state.head : null,
    checkedAt: state?.checkedAt ?? null,
    syncedAt: state?.syncedAt ?? null,
    errorCode: state?.errorCode ?? null,
    errorAt: state?.errorAt ?? null,
    copiedArtifacts: state?.copiedArtifacts ?? 0,
    copiedBytes: state?.copiedBytes ?? '0',
  };
}

export function registerMirrorRoutes(
  app: FastifyInstance,
  mirrors: MirrorStatus,
  principal: (request: FastifyRequest) => Principal,
) {
  app.get<{ Params: { repository: string } }>(
    '/api/v1/repositories/:repository/mirror',
    async (request) =>
      mirrorResponse(await mirrors.get(principal(request), request.params.repository)),
  );
}

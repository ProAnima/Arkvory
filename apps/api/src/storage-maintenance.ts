import { ArkvoryError, authorizeAction } from '@proanima/arkvory-domain';
import type { PostgresStoragePolicy, PostgresServices } from '@proanima/arkvory-infrastructure';

/** One bounded batch on the writer; database gates and due times fence overlapping runs. */
export async function maintainStorage(
  store: PostgresStoragePolicy,
  services: PostgresServices,
  active: () => boolean,
) {
  await store.monitorCapacities(active);
  for (const due of await store.due()) {
    if (!active()) return;
    try {
      const principal = await services.principalForKey(due.authorizer_key_id);
      if (!principal) throw new ArkvoryError('forbidden', 'Policy credential unavailable');
      authorizeAction(principal, due.repository, 'storage.manage', null);
      authorizeAction(principal, due.repository, 'artifact.delete', null);
      await store.run(
        { principal, repository: due.repository, actions: ['storage.manage', 'artifact.delete'] },
        due.revision,
        true,
      );
    } catch (error) {
      // Known machine codes only: connection details, secrets and exception text are excluded.
      await store.monitor(
        due.repository,
        due.revision,
        error instanceof ArkvoryError ? error.code : 'unavailable',
      );
    }
  }
}

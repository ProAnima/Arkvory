import { isOciDigest, ociFeedActions, parseOciDetail } from '@proanima/arkvory-domain';
import type { CatalogFeedEntry } from './catalog-ports.js';
import type { MirrorTarget } from './mirror-ports.js';

/** Registry changes of the feed (ADR 0063); the mirror applies them to its own registry rows. */
export const isRegistryChange = (action: string) => action.startsWith('oci.');

/**
 * Applies one registry change of the source. Blob and manifest rows point at artifacts with the
 * source IDs, so the artifact is refreshed first: content gone on the source since is skipped,
 * because a later entry of the feed removes it there too. Malformed details and newer `oci.*`
 * actions only refresh the artifact, like any action the mirror does not know.
 */
export async function applyRegistryChange(
  change: CatalogFeedEntry,
  target: Pick<MirrorTarget, 'ociBlob' | 'ociManifest' | 'ociUntag' | 'ociForget'>,
  refresh: (id: string) => Promise<boolean>,
): Promise<void> {
  const id = change.artifactId;
  const detail = parseOciDetail(change.detail);
  const named = detail && 'digest' in detail ? detail : null;
  const tagged = detail && 'tag' in detail ? detail : null;
  const digest = change.detail !== null && isOciDigest(change.detail) ? change.detail : null;
  switch (change.action) {
    case ociFeedActions.blob:
      if (digest === null) break;
      if (await refresh(id)) await target.ociBlob(digest, id);
      return;
    case ociFeedActions.manifest:
      if (named === null) break;
      if (await refresh(id)) await target.ociManifest(named.image, id, null);
      return;
    case ociFeedActions.tag:
      if (tagged === null) break;
      if (await refresh(id)) await target.ociManifest(tagged.image, id, tagged.tag);
      return;
    case ociFeedActions.tagDeleted:
      if (tagged === null) break;
      return target.ociUntag(tagged.image, tagged.tag);
    case ociFeedActions.manifestDeleted:
      if (named === null) break;
      return target.ociForget(named.image, named.digest);
  }
  await refresh(id);
}

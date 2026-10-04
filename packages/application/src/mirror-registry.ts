import {
  isLfsOid,
  isOciDigest,
  lfsObjectAction,
  ociFeedActions,
  parseOciDetail,
} from '@proanima/arkvory-domain';
import type { CatalogFeedEntry } from './catalog-ports.js';
import type { MirrorTarget } from './mirror-ports.js';

/**
 * Index changes of the feed: container registry (ADR 0063) and Git LFS objects (ADR 0065). They
 * have no listing to seed from, so a mirror replays them; it applies them to its own rows.
 */
export const isRegistryChange = (action: string) =>
  action.startsWith('oci.') || action === lfsObjectAction;

/**
 * Applies one registry change of the source. Blob and manifest rows point at artifacts with the
 * source IDs, so the artifact is refreshed first: content gone on the source since is skipped,
 * because a later entry of the feed removes it there too. Malformed details and newer `oci.*`
 * actions only refresh the artifact, like any action the mirror does not know.
 */
export async function applyRegistryChange(
  change: CatalogFeedEntry,
  target: Pick<MirrorTarget, 'ociBlob' | 'ociManifest' | 'ociUntag' | 'ociForget' | 'lfsObject'>,
  refresh: (id: string) => Promise<boolean>,
): Promise<void> {
  const id = change.artifactId;
  const detail = parseOciDetail(change.detail);
  const named = detail && 'digest' in detail ? detail : null;
  const tagged = detail && 'tag' in detail ? detail : null;
  const digest =
    change.detail !== null &&
    (change.action === lfsObjectAction ? isLfsOid(change.detail) : isOciDigest(change.detail))
      ? change.detail
      : null;
  switch (change.action) {
    case lfsObjectAction:
      if (digest === null) break;
      if (await refresh(id)) await target.lfsObject(digest, id);
      return;
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

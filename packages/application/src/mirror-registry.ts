import {
  isLfsOid,
  isOciDigest,
  lfsObjectAction,
  npmFeedActions,
  ociFeedActions,
  parseNpmDetail,
  parseOciDetail,
} from '@proanima/arkvory-domain';
import type { CatalogFeedEntry } from './catalog-ports.js';
import type { MirrorTarget } from './mirror-ports.js';

/**
 * Index changes of the feed: container registry (ADR 0063), Git LFS objects (ADR 0065) and npm
 * packages (ADR 0066). They have no listing to seed from, so a mirror replays them; it applies
 * them to its own rows.
 */
export const isRegistryChange = (action: string) =>
  action.startsWith('oci.') || action.startsWith('npm.') || action === lfsObjectAction;

type Target = Pick<
  MirrorTarget,
  | 'ociBlob'
  | 'ociManifest'
  | 'ociUntag'
  | 'ociForget'
  | 'lfsObject'
  | 'npmVersion'
  | 'npmTag'
  | 'npmUntag'
>;

/** npm entries; false for actions of the other registries. */
async function applyNpmChange(
  change: CatalogFeedEntry,
  target: Target,
  refresh: (id: string) => Promise<boolean>,
): Promise<boolean> {
  const detail = parseNpmDetail(change.detail);
  switch (change.action) {
    case npmFeedActions.version:
      if (await refresh(change.artifactId)) await target.npmVersion(change.artifactId);
      return true;
    case npmFeedActions.tag:
      if (detail?.tag && detail.version)
        await target.npmTag(detail.name, detail.tag, detail.version);
      return true;
    case npmFeedActions.tagDeleted:
      if (detail?.tag) await target.npmUntag(detail.name, detail.tag);
      return true;
    default:
      return false;
  }
}

/**
 * Applies one registry change of the source. Blob and manifest rows point at artifacts with the
 * source IDs, so the artifact is refreshed first: content gone on the source since is skipped,
 * because a later entry of the feed removes it there too. Malformed details and newer `oci.*`
 * actions only refresh the artifact, like any action the mirror does not know.
 */
export async function applyRegistryChange(
  change: CatalogFeedEntry,
  target: Target,
  refresh: (id: string) => Promise<boolean>,
): Promise<void> {
  if (await applyNpmChange(change, target, refresh)) return;
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

import type { ReleaseKey } from './release-signature.js';

/**
 * Public keys whose signatures this updater accepts for releases from the network (ADR 0060).
 * Rotation: release N ships the old and the new key, releases after N are signed with the new
 * key, and the old key is removed once no installation older than N remains supported.
 */
export const releaseKeys: readonly ReleaseKey[] = [
  // Created 2026-10-03; private key on the release workstation (~/.proanima), backed up offline.
  { id: 'da120f962d5154fd', publicKey: 'f57lOeocwHTe1sNeI8NiC/JgWs+mQ+xon5WdJZ8kDgg=' },
];

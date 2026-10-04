import type { Upload } from '@proanima/arkvory-domain';

/**
 * An upload found by an idempotency key that can no longer receive bytes: deleted, or expired
 * before its bytes arrived. Content-addressed keys (Git LFS, npm) then start over under a fresh
 * key; otherwise one interrupted transfer would block that content for its owner for good.
 */
export const unusable = (upload: Upload, now: string): boolean =>
  upload.status === 'cancelled' ||
  (upload.status === 'pending' && Date.parse(upload.expiresAt) <= Date.parse(now));

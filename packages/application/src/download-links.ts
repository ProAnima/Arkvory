import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { CredentialRejection } from './identity.js';
import type { StorageService } from './storage.js';

/** Lifetime of a download link in seconds (ADR 0062): an hour unless asked, a day at most. */
export const downloadLinkTtl = { min: 60, default: 3600, max: 86400 } as const;

export interface DownloadLinkBinding {
  readonly repository: string;
  readonly artifactId: string;
  /** Principal id of whoever created the link; its transfer budget pays for the downloads. */
  readonly issuer: string;
}
export interface CreatedDownloadLink {
  /** The secret; returned once, stored only as its SHA-256. */
  readonly token: string;
  readonly expiresAt: string;
}
/** Download links of the catalog (ADR 0062). */
export interface DownloadLinkStore {
  create(link: DownloadLinkBinding & { readonly ttlSeconds: number }): Promise<CreatedDownloadLink>;
  /** The binding of a live link, or null for an unknown, malformed or expired secret. */
  resolve(token: string): Promise<DownloadLinkBinding | null>;
  rejection(token: string): Promise<CredentialRejection>;
}

/**
 * Short-lived download links (ADR 0062): whoever may read an artifact's content may hand that
 * one artifact to someone else for up to a day, without sharing a long-lived credential.
 */
export class DownloadLinks {
  constructor(
    private readonly storage: Pick<StorageService, 'artifact'>,
    private readonly store: DownloadLinkStore,
  ) {}

  async create(
    principal: Principal,
    repository: string,
    id: string,
    ttlSeconds: number = downloadLinkTtl.default,
  ): Promise<CreatedDownloadLink> {
    // A link never extends itself: only a credential of its own may issue one.
    if (principal.credential === 'transfer-token')
      throw new ArkvoryError('forbidden', 'A download link cannot issue links', {
        reason: 'permission_missing',
      });
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < downloadLinkTtl.min ||
      ttlSeconds > downloadLinkTtl.max
    )
      throw new ArkvoryError('invalid_input', 'Link lifetime is outside 60 seconds to one day', {
        details: [{ field: '/ttlSeconds', problem: 'range' }],
      });
    const upload = await this.storage.artifact(principal, repository, id, 'content.read');
    return this.store.create({
      repository,
      artifactId: upload.id,
      issuer: principal.id,
      ttlSeconds,
    });
  }

  /**
   * The principal a link authenticates for the content of `id` in `repository`, or null when
   * the link is not live or names another artifact. It may read that repository and nothing
   * else; the API admits it on the artifact content route only, so it reaches one artifact.
   */
  async principal(token: string, repository: string, id: string): Promise<Principal | null> {
    const link = await this.store.resolve(token);
    if (!link || link.repository !== repository || link.artifactId !== id) return null;
    return {
      credential: 'transfer-token',
      id: link.issuer,
      repositories: [repository],
      permissions: ['read'],
      grants: [{ repository, permissions: ['read'] }],
    };
  }

  rejection(token: string): Promise<CredentialRejection> {
    return this.store.rejection(token);
  }
}

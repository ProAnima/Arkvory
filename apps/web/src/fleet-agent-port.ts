import type { SiteChange } from '@proanima/arkvory-contracts';

/** Sends one change to the site's agent (ADR 0077, stage F3); true when it was queued. */
export type Submit = (change: SiteChange, key?: string) => Promise<boolean>;

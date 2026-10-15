import type { SiteChange } from '@proanima/arkvory-contracts';

/** Sends one change to the site's agent (ADR 0077, stage F3); true when it was queued. */
export type Send = (change: SiteChange, key?: string) => Promise<boolean>;
/**
 * Binds a send to the site shown now. Call it before asking for confirmation: if the panel
 * moved to another site (or closed) meanwhile, the bound send drops the change instead of
 * sending it to whatever site is shown when the dialog closes.
 */
export type Submit = () => Send;

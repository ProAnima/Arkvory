// Imported first by every entry of this app, before any library code runs (ADR 0031,
// addendum 2026-10-18): module resolution stays inside the release directory.
import { confineEntry } from '@proanima/arkvory-resolution';

confineEntry(import.meta.url);

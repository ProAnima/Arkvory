// Imported first by every entry of this app, before any library code runs (ADR 0031,
// addendum 2026-10-18): module resolution stays inside the release directory.
import { allowResolutionUnder, confineEntry } from '@proanima/arkvory-resolution';

confineEntry(import.meta.url);
// Signed modules live outside the release, in the directory the installation names (ADR 0079,
// X4); their loader confines each one to its own package, which is stricter than this.
const modules = process.env['ARKVORY_MODULES_DIR'];
if (modules) allowResolutionUnder(modules, { optional: true });

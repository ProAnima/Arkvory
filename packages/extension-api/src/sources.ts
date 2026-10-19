/**
 * Where a module comes from (ADR 0082, section 1): the core release itself, a package signed by
 * ProAnimaStudio, an operator's plugin signed by a key the host trusts, or an unsigned plugin of a
 * `development` installation. Every source but `builtin` is external to the release.
 */
export const MODULE_SOURCES = ['builtin', 'signed', 'operator', 'development'] as const;
export type ModuleSource = (typeof MODULE_SOURCES)[number];

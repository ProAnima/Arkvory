/**
 * Highest migration recorded by migrate(). Runtime roles and release manifests share this value:
 * the updater skips migrations for equal release schemas, so a stale copy would start new code on
 * an old database. Every new migration must raise it in the same change.
 */
export const SCHEMA_VERSION = 30;

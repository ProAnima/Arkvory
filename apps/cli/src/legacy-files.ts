import { existsSync } from 'node:fs';
import { CliError } from './errors.js';

/** Reuse an existing checkpoint/profile in place; never copy credentials or partial bytes. */
export function compatiblePath(current: string, legacy: string): string {
  if (!existsSync(legacy)) return current;
  if (existsSync(current)) throw new CliError('checkpoint_mismatch', 6);
  return legacy;
}

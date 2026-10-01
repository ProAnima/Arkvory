import { ArkvoryError, requireRepository } from './artifact.js';
import { fieldError, withField } from './errors.js';

export const MAX_STAGES = 16;
export type PromotionMode = 'copy' | 'move';
export interface PromotionRequest {
  readonly target: string;
  readonly mode: PromotionMode;
  readonly stages: readonly string[];
  readonly comment: string | null;
}

/** Stages are controlled labels; a narrower alphabet keeps them readable in URLs and filters. */
export function requireStage(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Invalid promotion stage');
  return value;
}

export function requireComment(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    // Unicode mode matches unpaired surrogates only; line breaks and tabs remain allowed.
    /[\uD800-\uDFFF]/u.test(value) ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  )
    throw new ArkvoryError('invalid_input', 'Invalid promotion comment');
  return value;
}

export function requireStages(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STAGES)
    throw new ArkvoryError('invalid_input', `At most ${String(MAX_STAGES)} stages allowed`);
  return [...new Set(value.map(requireStage))].sort();
}

/** Parses the request body; failures name its members as JSON Pointers (ADR 0051). */
export function parsePromotionRequest(value: unknown): PromotionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw fieldError('/', 'type', 'Invalid promotion request');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(input).find(
    (key) => !['target', 'mode', 'stages', 'comment'].includes(key),
  );
  if (unknown !== undefined)
    throw fieldError(`/${unknown.slice(0, 64)}`, 'unknown_field', 'Unknown promotion field');
  const mode = input['mode'] ?? 'copy';
  if (mode !== 'copy' && mode !== 'move')
    throw fieldError('/mode', 'invalid', 'Promotion mode must be copy or move');
  const target = input['target'];
  if (typeof target !== 'string')
    throw fieldError('/target', 'required', 'Promotion target is required');
  return {
    target: withField('/target', () => requireRepository(target)),
    mode,
    stages: withField('/stages', () => requireStages(input['stages'])),
    comment: withField('/comment', () => requireComment(input['comment'])),
  };
}

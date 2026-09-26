import { ArkvoryError, requireId } from './artifact.js';

export interface RetentionCriteria {
  publishedBefore: string;
  protectedLabels: readonly string[];
}
export interface DeletionSelection {
  id: string;
  expectedAnnotationRevision: number;
}
export function retentionObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Object required');
  const row = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown retention property');
  return row;
}
export function parseRetentionCriteria(value: unknown, now: string): RetentionCriteria {
  const row = retentionObject(value, ['publishedBefore', 'protectedLabels']);
  const before = row['publishedBefore'],
    labels: unknown = row['protectedLabels'];
  if (
    typeof before !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(before) ||
    !Number.isFinite(Date.parse(before)) ||
    new Date(before).toISOString() !== before ||
    Date.parse(before) > Date.parse(now)
  )
    throw new ArkvoryError(
      'invalid_input',
      'publishedBefore must be a past UTC timestamp with milliseconds',
    );
  if (
    !Array.isArray(labels) ||
    labels.length > 32 ||
    labels.some(
      (label: unknown) => typeof label !== 'string' || !/^[\p{L}\p{N}_.:-]{1,64}$/u.test(label),
    )
  )
    throw new ArkvoryError('invalid_input', 'Explicit protectedLabels required (at most 32)');
  const checked: string[] = [];
  for (const label of labels) if (typeof label === 'string') checked.push(label);
  if (new Set(checked).size !== checked.length)
    throw new ArkvoryError('invalid_input', 'Duplicate protected label');
  return { publishedBefore: before, protectedLabels: checked };
}
export function annotationRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647)
    throw new ArkvoryError('invalid_input', 'Expected annotation revision required');
  return value;
}
export function parseDeletionSelection(value: unknown): readonly DeletionSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new ArkvoryError('invalid_input', 'Select between 1 and 100 artifacts');
  const selected = value.map((entry: unknown) => {
    const row = retentionObject(entry, ['id', 'expectedAnnotationRevision']);
    if (typeof row['id'] !== 'string')
      throw new ArkvoryError('invalid_input', 'Artifact ID required');
    return {
      id: requireId(row['id']),
      expectedAnnotationRevision: annotationRevision(row['expectedAnnotationRevision']),
    };
  });
  if (new Set(selected.map((entry) => entry.id)).size !== selected.length)
    throw new ArkvoryError('invalid_input', 'Duplicate artifact selection');
  return selected;
}

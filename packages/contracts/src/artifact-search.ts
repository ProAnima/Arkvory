import { record, text, items } from './wire-values.js';

export interface ArtifactSearchItemResponse {
  id: string;
  name: string;
  /** Byte size as a decimal string; full 64-bit values survive JSON. */
  size: string;
  createdAt: string;
  /** Null only for an artifact without a recorded publication time. */
  publishedAt: string | null;
  /** Current labels: the annotation when replaced, otherwise the upload descriptor. */
  labels: readonly string[];
  /** Current promotion stages in byte order, at most 16. */
  stages: readonly string[];
}
export interface ArtifactSearchPageResponse {
  /** Mutable array: the SDK search result stays assignable to the original `{ id, name }[]`. */
  items: ArtifactSearchItemResponse[];
  next: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decimalSize = '^(0|[1-9][0-9]{0,15})$';
const stagePattern = '^[a-z0-9][a-z0-9_.-]{0,31}$';
const time = { type: 'string', format: 'date-time' } as const;

export const artifactSearchItemSchema = {
  type: 'object',
  required: ['id', 'name', 'size', 'createdAt', 'publishedAt', 'labels', 'stages'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    size: { type: 'string', pattern: decimalSize, description: 'Byte size, decimal string' },
    createdAt: { ...time, description: 'Upload reservation time' },
    publishedAt: {
      ...time,
      nullable: true,
      description: 'Publication time; null only when none was recorded',
    },
    labels: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string' },
      description: 'Current labels: annotation when replaced, otherwise the upload descriptor',
    },
    stages: {
      type: 'array',
      maxItems: 16,
      items: { type: 'string', pattern: stagePattern },
      description: 'Current promotion stages in byte order',
    },
  },
} as const;

function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid timestamp');
  return result;
}
function strings(value: unknown, limit: number, pattern?: RegExp): readonly string[] {
  const list = items(value).map(text);
  if (list.length > limit || (pattern && list.some((entry) => !pattern.test(entry))))
    throw new Error('Invalid search item list');
  return list;
}

export function readArtifactSearchItem(value: unknown): ArtifactSearchItemResponse {
  const r = record(value);
  const id = text(r['id']);
  const size = text(r['size']);
  if (!uuid.test(id) || !new RegExp(decimalSize).test(size)) throw new Error('Invalid search item');
  return {
    id,
    name: text(r['name']),
    size,
    createdAt: timestamp(r['createdAt']),
    publishedAt: r['publishedAt'] === null ? null : timestamp(r['publishedAt']),
    labels: strings(r['labels'], 32),
    stages: strings(r['stages'], 16, new RegExp(stagePattern)),
  };
}
export function readArtifactSearchPage(value: unknown): ArtifactSearchPageResponse {
  const r = record(value);
  return {
    items: items(r['items']).map(readArtifactSearchItem),
    next: r['next'] === null ? null : text(r['next']),
  };
}

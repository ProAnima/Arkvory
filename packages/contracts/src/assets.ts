import { record, text, integer, items } from './responses.js';

export interface AssetResponse {
  path: string;
  revision: number;
  artifactId: string;
}
export interface AssetRevisionResponse extends AssetResponse {
  actor: string | null;
  createdAt: string | null;
  sourceRevision: number | null;
}
export interface AssetHistoryResponse {
  items: readonly AssetRevisionResponse[];
  next: number | null;
}
function positiveRevision(value: unknown): number {
  const result = integer(value);
  if (result < 1 || result > 2147483647) throw new Error('Invalid server asset revision');
  return result;
}
export function readAsset(value: unknown): AssetResponse {
  const r = record(value);
  return {
    path: text(r['path']),
    revision: positiveRevision(r['revision']),
    artifactId: text(r['artifactId']),
  };
}
export function readAssetRevision(value: unknown): AssetRevisionResponse {
  const r = record(value);
  const asset = readAsset(r);
  const sourceRevision =
    r['sourceRevision'] === null ? null : positiveRevision(r['sourceRevision']);
  if (sourceRevision !== null && sourceRevision >= asset.revision)
    throw new Error('Invalid server restore source');
  const createdAt = r['createdAt'] === null ? null : text(r['createdAt']);
  if (createdAt !== null && !Number.isFinite(Date.parse(createdAt)))
    throw new Error('Invalid server revision date');
  return {
    ...asset,
    actor: r['actor'] === null ? null : text(r['actor']),
    createdAt,
    sourceRevision,
  };
}
export function readAssetHistory(value: unknown): AssetHistoryResponse {
  const r = record(value);
  const entries = items(r['items']).map(readAssetRevision);
  const next = r['next'] === null ? null : positiveRevision(r['next']);
  if (
    entries.length > 50 ||
    (next !== null && (entries.length !== 50 || next !== entries.at(-1)?.revision))
  )
    throw new Error('Invalid server history cursor');
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    if (previous && (entry.path !== previous.path || entry.revision >= previous.revision))
      throw new Error('Invalid server history order');
  }
  return { items: entries, next };
}

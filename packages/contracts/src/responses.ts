import type { UploadResponse } from './native.js';

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid server object');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid server string');
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid server integer');
  return value;
}
export function items(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid server array');
  return value;
}
export function strings(value: unknown): readonly string[] {
  return items(value).map(text);
}
export function stringMap(value: unknown): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, v]) => [key, text(v)]));
}
export function readUpload(value: unknown): UploadResponse {
  const row = record(value),
    d = record(row['descriptor']);
  const status = row['status'];
  if (status !== 'pending' && status !== 'available' && status !== 'cancelled')
    throw new Error('Invalid server upload state');
  const size = text(d['size']);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(size) || !Number.isSafeInteger(Number(size)))
    throw new Error('Invalid server size');
  return {
    id: text(row['id']),
    repository: text(row['repository']),
    status,
    createdAt: text(row['createdAt']),
    expiresAt: text(row['expiresAt']),
    descriptor: {
      name: text(d['name']),
      size,
      sha256: text(d['sha256']),
      labels: strings(d['labels']),
      metadata: stringMap(d['metadata']),
    },
  };
}
export interface AnnotationsResponse {
  revision: number;
  labels: readonly string[];
  metadata: Readonly<Record<string, string>>;
  collections: readonly string[];
}
export function readAnnotations(value: unknown): AnnotationsResponse {
  const r = record(value);
  return {
    revision: integer(r['revision']),
    labels: strings(r['labels']),
    metadata: stringMap(r['metadata']),
    collections: strings(r['collections']),
  };
}
export interface JobResponse {
  id: string;
  uploadId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  errorCode: string | null;
}
export function readJob(value: unknown): JobResponse {
  const r = record(value),
    status = r['status'];
  if (status !== 'queued' && status !== 'running' && status !== 'completed' && status !== 'failed')
    throw new Error('Invalid server job state');
  return {
    id: text(r['id']),
    uploadId: text(r['uploadId']),
    status,
    attempts: integer(r['attempts']),
    errorCode: r['errorCode'] === null ? null : text(r['errorCode']),
  };
}

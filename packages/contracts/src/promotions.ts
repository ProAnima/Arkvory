import { record, text, items } from './wire-values.js';

export const promotionModes = ['copy', 'move'] as const;
export const promotionActions = ['stage.added', 'stage.removed', 'promoted', 'received'] as const;
export type PromotionModeWire = (typeof promotionModes)[number];
export interface StageResponse {
  artifactId: string;
  stage: string;
  promotedAt: string;
  actor: string;
  comment: string | null;
}
export interface StagePageResponse {
  items: readonly StageResponse[];
  next: string | null;
}
export interface PromotionEventResponse {
  sequence: string;
  repository: string;
  artifactId: string;
  action: (typeof promotionActions)[number];
  stage: string | null;
  mode: PromotionModeWire | null;
  peerRepository: string | null;
  peerArtifactId: string | null;
  actor: string;
  comment: string | null;
  occurredAt: string;
}
export interface PromotionEventPageResponse {
  items: readonly PromotionEventResponse[];
  next: string | null;
}
export interface PromotionResultResponse {
  repository: string;
  artifactId: string;
  sourceRepository: string;
  sourceArtifactId: string;
  mode: PromotionModeWire;
  created: boolean;
  stages: readonly string[];
}
export interface ResolvedPackageResponse {
  group: string;
  name: string;
  version: string;
  artifactId: string;
  sha256: string;
  size: string;
  publishedAt: string;
  stagedAt: string | null;
  stages: readonly string[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stagePattern = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const id = (value: unknown) => {
  const result = text(value);
  if (!uuid.test(result)) throw new Error('Invalid artifact id');
  return result;
};
const stage = (value: unknown) => {
  const result = text(value);
  if (!stagePattern.test(result)) throw new Error('Invalid stage');
  return result;
};
const repository = (value: unknown) => {
  const result = text(value);
  if (!repositoryPattern.test(result)) throw new Error('Invalid repository');
  return result;
};
const time = (value: unknown) => {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid timestamp');
  return result;
};
const nullable = <T>(value: unknown, read: (value: unknown) => T): T | null =>
  value === null ? null : read(value);
const stages = (value: unknown) => {
  const list = items(value).map(stage);
  if (list.length > 16 || new Set(list).size !== list.length) throw new Error('Invalid stages');
  return list;
};
function isAction(value: unknown): value is PromotionEventResponse['action'] {
  return promotionActions.some((known) => known === value);
}
const mode = (value: unknown): PromotionModeWire => {
  if (value !== 'copy' && value !== 'move') throw new Error('Invalid promotion mode');
  return value;
};

export function readStage(value: unknown): StageResponse {
  const r = record(value);
  const comment = nullable(r['comment'], text);
  if (comment !== null && comment.length > 1024) throw new Error('Invalid stage comment');
  return {
    artifactId: id(r['artifactId']),
    stage: stage(r['stage']),
    promotedAt: time(r['promotedAt']),
    actor: text(r['actor']),
    comment,
  };
}
export function readStageList(value: unknown): readonly StageResponse[] {
  const list = items(record(value)['items']).map(readStage);
  if (list.length > 16) throw new Error('Invalid stage list');
  return list;
}
export function readStagePage(value: unknown): StagePageResponse {
  const r = record(value);
  const list = items(r['items']).map(readStage);
  if (list.length > 100) throw new Error('Invalid stage page');
  return { items: list, next: nullable(r['next'], text) };
}
export function readPromotionEvents(value: unknown): PromotionEventPageResponse {
  const r = record(value);
  const list = items(r['items']).map((entry): PromotionEventResponse => {
    const e = record(entry);
    const action = e['action'];
    if (!isAction(action)) throw new Error('Invalid promotion action');
    const sequence = text(e['sequence']);
    if (!/^[1-9][0-9]{0,18}$/.test(sequence)) throw new Error('Invalid promotion sequence');
    return {
      sequence,
      repository: repository(e['repository']),
      artifactId: id(e['artifactId']),
      action,
      stage: nullable(e['stage'], stage),
      mode: nullable(e['mode'], mode),
      peerRepository: nullable(e['peerRepository'], repository),
      peerArtifactId: nullable(e['peerArtifactId'], id),
      actor: text(e['actor']),
      comment: nullable(e['comment'], text),
      occurredAt: time(e['occurredAt']),
    };
  });
  if (list.length > 100) throw new Error('Invalid promotion page');
  return { items: list, next: nullable(r['next'], text) };
}
export function readPromotionResult(value: unknown): PromotionResultResponse {
  const r = record(value);
  if (typeof r['created'] !== 'boolean') throw new Error('Invalid promotion result');
  return {
    repository: repository(r['repository']),
    artifactId: id(r['artifactId']),
    sourceRepository: repository(r['sourceRepository']),
    sourceArtifactId: id(r['sourceArtifactId']),
    mode: mode(r['mode']),
    created: r['created'],
    stages: stages(r['stages']),
  };
}
export function readResolvedPackage(value: unknown): ResolvedPackageResponse {
  const r = record(value);
  const size = text(r['size']);
  const sha256 = text(r['sha256']);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(size) || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('Invalid resolved package');
  return {
    group: text(r['group']),
    name: text(r['name']),
    version: text(r['version']),
    artifactId: id(r['artifactId']),
    sha256,
    size,
    publishedAt: time(r['publishedAt']),
    stagedAt: nullable(r['stagedAt'], time),
    stages: stages(r['stages']),
  };
}

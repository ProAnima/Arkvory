import {
  readPromotionEvents,
  readPromotionResult,
  readResolvedPackage,
  readStage,
  readStageList,
  readStagePage,
} from '@proanima/arkvory-contracts';
import type { PromotionModeWire } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';

export interface PackageQuery {
  readonly name: string;
  readonly group?: string;
  /** Exact version; mutually exclusive with range. */
  readonly version?: string;
  /** SemVer range such as ^1.2, ~1.2.3 or >=1.0.0 <2.0.0. */
  readonly range?: string;
  readonly stage?: string;
  readonly prerelease?: boolean;
  /** promoted selects the most recently staged version and requires stage. */
  readonly order?: 'version' | 'promoted';
}
export interface PromoteRequest {
  readonly target: string;
  readonly mode?: PromotionModeWire;
  readonly stages?: readonly string[];
  readonly comment?: string;
}
export interface PageOptions {
  readonly after?: string;
  readonly limit?: number;
}

export function packageQueryString(query: PackageQuery): string {
  const params = new URLSearchParams();
  params.set('name', query.name);
  if (query.group !== undefined) params.set('group', query.group);
  if (query.version !== undefined) params.set('version', query.version);
  if (query.range !== undefined) params.set('range', query.range);
  if (query.stage !== undefined) params.set('stage', query.stage);
  if (query.prerelease !== undefined) params.set('prerelease', String(query.prerelease));
  if (query.order !== undefined) params.set('order', query.order);
  return params.toString();
}
function page(options: PageOptions & { stage?: string; ids?: readonly string[] }) {
  const params = new URLSearchParams();
  if (options.stage !== undefined) params.set('stage', options.stage);
  if (options.ids !== undefined) params.set('ids', options.ids.join(','));
  if (options.after !== undefined) params.set('after', options.after);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const text = params.toString();
  return text ? `?${text}` : '';
}
const artifact = (repository: string, id: string, suffix: string) =>
  repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/${suffix}`);

/** Stages, cross-repository promotion and version resolution for one server. */
export class PromotionsApi {
  constructor(private readonly http: HttpPort) {}

  async stages(repository: string, id: string, signal?: AbortSignal) {
    return readStageList(
      await this.http.call(artifact(repository, id, 'stages'), 'GET', undefined, signal),
    );
  }
  async setStage(
    repository: string,
    id: string,
    stage: string,
    comment?: string,
    signal?: AbortSignal,
  ) {
    const path = artifact(repository, id, `stages/${encodeURIComponent(stage)}`);
    return readStage(
      await this.http.call(path, 'PUT', comment === undefined ? {} : { comment }, signal),
    );
  }
  async removeStage(repository: string, id: string, stage: string, signal?: AbortSignal) {
    const path = artifact(repository, id, `stages/${encodeURIComponent(stage)}`);
    const response = await this.http.request(path, { method: 'DELETE' }, signal);
    await response.body?.cancel();
  }
  async promote(repository: string, id: string, request: PromoteRequest, signal?: AbortSignal) {
    return readPromotionResult(
      await this.http.call(artifact(repository, id, 'promote'), 'POST', request, signal),
    );
  }
  async history(repository: string, id: string, options: PageOptions = {}, signal?: AbortSignal) {
    const path = artifact(repository, id, `promotions${page(options)}`);
    return readPromotionEvents(await this.http.call(path, 'GET', undefined, signal));
  }
  async journal(repository: string, options: PageOptions = {}, signal?: AbortSignal) {
    const path = repositoryPath(repository, `promotions${page(options)}`);
    return readPromotionEvents(await this.http.call(path, 'GET', undefined, signal));
  }
  async staged(
    repository: string,
    options: PageOptions & { stage?: string; ids?: readonly string[] } = {},
    signal?: AbortSignal,
  ) {
    const path = repositoryPath(repository, `stages${page(options)}`);
    return readStagePage(await this.http.call(path, 'GET', undefined, signal));
  }
  async resolve(repository: string, query: PackageQuery, signal?: AbortSignal) {
    const path = repositoryPath(repository, `packages/resolve?${packageQueryString(query)}`);
    return readResolvedPackage(await this.http.call(path, 'GET', undefined, signal));
  }
}

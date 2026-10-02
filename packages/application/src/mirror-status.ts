import { ArkvoryError, authorizeAction } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { MirrorState, MirrorStateStore } from './mirror-ports.js';

/** A configured mirror as the status API shows it; the source key never leaves the worker. */
export interface MirrorConfiguration {
  readonly repository: string;
  readonly upstream: string;
  readonly sourceRepository: string;
  /** Import mode: versions with these stages are taken over into an ordinary repository. */
  readonly stages?: readonly string[];
}
export interface MirrorStatusEntry extends MirrorConfiguration {
  /** Null before the worker's first step. */
  readonly state: MirrorState | null;
}

/** Mirror status of one repository for the console and CLI (ADR 0058). */
export class MirrorStatus {
  constructor(
    private readonly mirrors: readonly MirrorConfiguration[],
    private readonly states: MirrorStateStore,
  ) {}

  /** Mirrored repositories of this installation: writes there are refused for every client. */
  get readOnlyRepositories(): readonly string[] {
    return this.mirrors.filter((mirror) => !mirror.stages).map((mirror) => mirror.repository);
  }

  /** States of every configured mirror, for the process metrics; no principal involved. */
  async all(): Promise<readonly MirrorStatusEntry[]> {
    return Promise.all(
      this.mirrors.map(async (mirror) => ({
        ...mirror,
        state: await this.states.load(mirror.repository),
      })),
    );
  }

  async get(principal: Principal, repository: string): Promise<MirrorStatusEntry> {
    authorizeAction(principal, repository, 'repository.read', ['read']);
    const mirror = this.mirrors.find((entry) => entry.repository === repository);
    if (!mirror) throw new ArkvoryError('not_found', 'The repository is not a mirror');
    const { upstream, sourceRepository } = mirror;
    return {
      repository,
      upstream,
      sourceRepository,
      ...(mirror.stages ? { stages: mirror.stages } : {}),
      state: await this.states.load(repository),
    };
  }
}

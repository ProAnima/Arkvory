import { ArkvoryError, authorizeAction } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { MirrorState, MirrorStateStore } from './mirror-ports.js';
import type { MirrorConflictReader, MirrorConflictSummary } from './mirror-conflicts.js';

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
  /** Entries of the source put aside on a conflict while the rest goes on. */
  readonly conflicts: MirrorConflictSummary;
}

/** The status names at most this many entries set aside; the count covers all of them. */
export const CONFLICT_SAMPLE = 10;

/** Mirror status of one repository for the console and CLI (ADR 0058). */
export class MirrorStatus {
  constructor(
    private readonly mirrors: readonly MirrorConfiguration[],
    private readonly states: MirrorStateStore,
    private readonly conflicts: MirrorConflictReader,
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
        conflicts: await this.conflicts.summary(mirror.repository, CONFLICT_SAMPLE),
      })),
    );
  }

  /** The mirrors whose repository the principal may read; others are left out, not refused. */
  async list(principal: Principal): Promise<readonly MirrorStatusEntry[]> {
    const visible = this.mirrors.filter((mirror) => {
      try {
        authorizeAction(principal, mirror.repository, 'repository.read', ['read']);
        return true;
      } catch {
        return false;
      }
    });
    return Promise.all(visible.map((mirror) => this.get(principal, mirror.repository)));
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
      conflicts: await this.conflicts.summary(repository, CONFLICT_SAMPLE),
    };
  }
}

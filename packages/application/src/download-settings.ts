import {
  ArkvoryError,
  downloadSettingValues,
  overrideDownloadPolicy,
  withField,
  type DownloadOverrides,
  type DownloadSchedulePolicy,
  type DownloadSettingValues,
} from '@proanima/arkvory-domain';

/** The changed queue settings of the installation and who changed them last. */
export interface StoredDownloadSettings {
  readonly revision: number;
  readonly overrides: DownloadOverrides;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  /** The administrator of a controller who asked through a fleet key (ADR 0077). */
  readonly actor: string | null;
}

export interface DownloadSettingsAuthor {
  readonly id: string;
  readonly actor: string | null;
}

/** Storage of the one settings record; `write` is compare-and-swap on `revision`. */
export interface DownloadSettingsStore {
  read(): Promise<StoredDownloadSettings>;
  /** Null when the stored revision is not `expectedRevision`. */
  write(
    expectedRevision: number,
    overrides: DownloadOverrides,
    author: DownloadSettingsAuthor,
  ): Promise<StoredDownloadSettings | null>;
}

/** The running queue; a new policy takes effect from its next decision. */
export interface DownloadPolicyTarget {
  configure(policy: DownloadSchedulePolicy): void;
}

export interface DownloadSettingsView extends StoredDownloadSettings {
  /** What the environment of this server sets. */
  readonly defaults: DownloadSettingValues;
  /** What the queue uses now. */
  readonly effective: DownloadSettingValues;
  /**
   * The stored settings do not fit this server any more (its environment changed since): the
   * queue runs on the defaults until an administrator saves settings that fit.
   */
  readonly problem: string | null;
}

/**
 * Queue settings changed while the server runs (ADR 0076, stage 3). The record is shared by the
 * writers of an installation; each applies it when it changes, so the newest saved settings win
 * everywhere within one `sync` period without a restart.
 */
export class DownloadSettingsControl {
  private applied = -1;
  private problem: string | null = null;

  constructor(
    private readonly store: DownloadSettingsStore,
    private readonly base: DownloadSchedulePolicy,
    private readonly target: DownloadPolicyTarget,
  ) {}

  async view(): Promise<DownloadSettingsView> {
    return this.present(await this.store.read());
  }

  /** Validates against this server first: settings that cannot run are never stored. */
  async change(
    expectedRevision: number,
    overrides: DownloadOverrides,
    author: DownloadSettingsAuthor,
  ): Promise<DownloadSettingsView> {
    const policy = withField('/overrides', () => overrideDownloadPolicy(this.base, overrides));
    const stored = await this.store.write(expectedRevision, overrides, author);
    if (!stored)
      throw new ArkvoryError('conflict', 'Download settings changed meanwhile: read them again', {
        reason: 'revision_mismatch',
      });
    this.target.configure(policy);
    this.applied = stored.revision;
    this.problem = null;
    return this.present(stored);
  }

  /** Applies the stored settings when their revision moved; cheap when nothing changed. */
  async sync(): Promise<void> {
    this.apply(await this.store.read());
  }

  private apply(stored: StoredDownloadSettings) {
    if (stored.revision === this.applied) return;
    this.applied = stored.revision;
    try {
      this.target.configure(overrideDownloadPolicy(this.base, stored.overrides));
      this.problem = null;
    } catch (error) {
      this.target.configure(this.base);
      this.problem = error instanceof Error ? error.message : 'invalid settings';
    }
  }

  private present(stored: StoredDownloadSettings): DownloadSettingsView {
    this.apply(stored);
    let effective = this.base;
    if (this.problem === null) effective = overrideDownloadPolicy(this.base, stored.overrides);
    return {
      ...stored,
      defaults: downloadSettingValues(this.base),
      effective: downloadSettingValues(effective),
      problem: this.problem,
    };
  }
}

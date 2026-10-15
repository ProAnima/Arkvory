import {
  ArkvoryError,
  downloadSettingValues,
  fieldError,
  knownDownloadOverrides,
  overrideDownloadPolicy,
  withField,
  type DownloadOverrides,
  type DownloadSchedulePolicy,
  type DownloadSettingValues,
} from '@proanima/arkvory-domain';

/** The changed queue settings of the installation and who changed them last. */
export interface StoredDownloadSettings {
  readonly revision: number;
  /** As stored: read by `knownDownloadOverrides`, so a bad row never stops the server. */
  readonly overrides: unknown;
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

export interface DownloadSettingsView extends Omit<StoredDownloadSettings, 'overrides'> {
  readonly overrides: DownloadOverrides;
  /** What the environment of this server sets. */
  readonly defaults: DownloadSettingValues;
  /** What the queue of this process uses now. */
  readonly effective: DownloadSettingValues;
  /**
   * `per-request` under the `shared` strategy: downloads are admitted one request at a time by
   * the limits of the environment, and the session settings wait unused.
   */
  readonly admission: 'sessions' | 'per-request';
  /**
   * Why the stored settings are not used here: they do not fit this server (its environment
   * changed since), or this process is a read gateway, which keeps its environment.
   */
  readonly problem: string | null;
}

export interface DownloadSettingsOptions {
  /** Writers apply the record; read gateways queue per process and keep their environment. */
  readonly applies: boolean;
  /**
   * The installation runs read gateways: their admission is per request, so a writer keeps the
   * `shared` strategy too, or ranges of one download would meet two kinds of queue.
   */
  readonly gateways: boolean;
}

const GATEWAY = 'A read gateway keeps the download queue of its environment';
const SHARED = 'With read gateways downloads are admitted per request: the strategy stays shared';

/**
 * Queue settings changed while the server runs (ADR 0076, stage 3). The record is shared by the
 * writers of an installation; each applies a newer revision when it sees one, so the newest saved
 * settings win everywhere within one `sync` period without a restart.
 */
export class DownloadSettingsControl {
  /** The revision running now; an older read arriving late never replaces it. */
  private applied = -1;

  constructor(
    private readonly store: DownloadSettingsStore,
    private readonly base: DownloadSchedulePolicy,
    private readonly target: DownloadPolicyTarget,
    private readonly options: DownloadSettingsOptions = { applies: true, gateways: false },
  ) {}

  async view(): Promise<DownloadSettingsView> {
    const stored = await this.store.read();
    this.applyNewer(stored);
    return this.present(stored);
  }

  /** Validates against this server first: settings that cannot run are never stored. */
  async change(
    expectedRevision: number,
    overrides: DownloadOverrides,
    author: DownloadSettingsAuthor,
  ): Promise<DownloadSettingsView> {
    if (!this.options.applies)
      throw new ArkvoryError('read_only', 'Change the download queue on the writer');
    if (this.options.gateways && overrides.strategy && overrides.strategy !== 'shared')
      throw fieldError('/overrides/strategy', 'invalid', SHARED);
    const policy = withField('/overrides', () => overrideDownloadPolicy(this.base, overrides));
    const stored = await this.store.write(expectedRevision, overrides, author);
    if (!stored)
      throw new ArkvoryError('conflict', 'Download settings changed meanwhile: read them again', {
        reason: 'revision_mismatch',
      });
    if (stored.revision > this.applied) {
      this.target.configure(policy);
      this.applied = stored.revision;
    }
    return this.present(stored);
  }

  /** Applies the stored settings when their revision is newer than the running one. */
  async sync(): Promise<void> {
    this.applyNewer(await this.store.read());
  }

  private applyNewer(stored: StoredDownloadSettings) {
    if (!this.options.applies || stored.revision <= this.applied) return;
    this.applied = stored.revision;
    this.target.configure(this.policyOf(stored).policy);
  }

  /**
   * The policy a writer runs for the record. A record saved before read gateways were added (or
   * by a writer that did not know of them) may ask for sessions: with gateways the writer keeps
   * its environment then, as `change` would have refused it.
   */
  private policyOf(stored: StoredDownloadSettings) {
    try {
      const overrides = knownDownloadOverrides(stored.overrides);
      if (this.options.gateways && overrides.strategy && overrides.strategy !== 'shared')
        return { overrides, policy: this.base, problem: SHARED };
      return { overrides, policy: overrideDownloadPolicy(this.base, overrides), problem: null };
    } catch (error) {
      return {
        overrides: {},
        policy: this.base,
        problem: error instanceof Error ? error.message : 'Invalid download settings',
      };
    }
  }

  /** Shows the record and what runs; the caller applied a newer record before. */
  private present(stored: StoredDownloadSettings): DownloadSettingsView {
    const { overrides, policy, problem } = this.policyOf(stored);
    const running = this.options.applies && problem === null ? policy : this.base;
    return {
      ...stored,
      overrides,
      defaults: downloadSettingValues(this.base),
      effective: downloadSettingValues(running),
      admission: running.strategy === 'shared' ? 'per-request' : 'sessions',
      problem: this.options.applies ? problem : GATEWAY,
    };
  }
}

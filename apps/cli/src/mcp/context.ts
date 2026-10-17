import type {
  ArkvoryClient,
  BackupApi,
  FleetApi,
  PromotionsApi,
  ReplicationApi,
} from '@proanima/arkvory-sdk';

/**
 * The SDK operations the tools use: reads, and with `--write` uploads, stages and annotations.
 * The tools see nothing else of the client (no deletion, links or administration), and a test
 * can stand in a fake with the same shape.
 */
export type McpClient = Pick<
  ArkvoryClient,
  | 'repositories'
  | 'searchAll'
  | 'list'
  | 'artifact'
  | 'annotations'
  | 'attachments'
  | 'packages'
  | 'assetPage'
  | 'assetHistory'
  | 'catalogChanges'
  | 'capabilities'
  | 'mirrors'
  | 'downloadVerified'
  | 'create'
  | 'status'
  | 'resume'
  | 'registerPackage'
  | 'asset'
  | 'setAsset'
  | 'annotate'
> & {
  readonly promotions: Pick<PromotionsApi, 'stages' | 'resolve' | 'setStage' | 'removeStage'>;
  readonly backup: Pick<BackupApi, 'status'>;
  readonly fleet: Pick<FleetApi, 'overview'>;
  readonly replication: Pick<ReplicationApi, 'state'>;
};

/** What `--write` allows (ADR 0081, stage M2). */
export interface WriteOptions {
  /** `--write-repositories`: the only repositories a write may name; null when not limited. */
  readonly repositories: ReadonlySet<string> | null;
  /** Private directory of upload checkpoints and receipts below the CLI home. */
  readonly checkpoints: string;
  /** Server URL the checkpoints are bound to. */
  readonly server: string;
}

export interface ToolContext {
  readonly client: McpClient;
  /** The profile's repository: the default of every tool that takes `repository`. */
  readonly repository: string;
  /** Real path of `--root`; local files are read and written only below it. */
  readonly root: string;
  /** Bound of one tool result in UTF-8 bytes (`--max-output-bytes`). */
  readonly maxOutputBytes: number;
  /** Values that must never reach a result, such as the key; replaced if they ever appear. */
  readonly secrets: readonly string[];
  /** Deadline of one metadata request; transfers keep the SDK's own attempt deadlines. */
  readonly requestTimeoutMs: number;
  /** Present only with `--write`: the write tools are registered only then. */
  readonly write?: WriteOptions;
}

/** Actions of the key (`GET /api/v1/auth/permissions`) that decide which tools are offered. */
export type KeyActions = ReadonlySet<string>;

import type { ModuleSignal } from './descriptor.js';
import type { ModuleJson } from './json.js';

/** A sequenced catalog event. Security events never enter this service. */
export interface ChangeEvent {
  readonly id: string;
  readonly type: string;
  readonly repository: string | null;
  readonly subject: string;
  readonly data: Readonly<Record<string, ModuleJson>>;
}
export interface FeedSubscription {
  close(): Promise<void>;
}
export interface ChangeSubscription {
  readonly consumer: string;
  readonly types: readonly string[];
  readonly batch: number;
  /** At least once: acknowledge only after all effects are durable. */
  handle(events: readonly ChangeEvent[], signal: ModuleSignal): Promise<void>;
  resync(reason: 'epoch_changed' | 'cursor_expired', signal: ModuleSignal): Promise<void>;
}
export interface ChangeFeed {
  subscribe(spec: ChangeSubscription): FeedSubscription;
}

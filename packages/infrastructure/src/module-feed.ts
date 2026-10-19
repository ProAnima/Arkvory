import { setTimeout as delay } from 'node:timers/promises';
import { parseEventTypes } from '@proanima/arkvory-application';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ChangeFeed,
  ChangeSubscription,
  ModuleJson,
  ModuleSignal,
} from '@proanima/arkvory-extension-api';
import type { PostgresEventLog } from './event-log.js';
import type { PostgresModuleCursors } from './module-feed-store.js';

function json(value: unknown, depth = 0): ModuleJson {
  if (depth > 16) throw new ModuleServiceError('invalid_input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry: unknown) => json(entry, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, json(entry, depth + 1)]),
    );
  throw new ModuleServiceError('invalid_input');
}

/** Active-worker subscriptions. A timed-out callback is never overlapped with a retry. */
export class ModuleChangeFeed {
  private readonly enabled = new Set<string>();
  activate(module: string): void {
    this.enabled.add(module);
  }
  private readonly subscriptions = new Map<
    string,
    { cancel: AbortController; done: Promise<void> }
  >();
  constructor(
    private readonly log: PostgresEventLog,
    private readonly cursors: PostgresModuleCursors,
    private readonly active: () => boolean,
    private readonly callbackMs = 60_000,
  ) {}
  for(module: string): ChangeFeed {
    return { subscribe: (spec) => this.subscribe(module, spec) };
  }
  private subscribe(module: string, spec: ChangeSubscription) {
    const key = `${module}:${spec.consumer}`;
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(spec.consumer) ||
      !Number.isSafeInteger(spec.batch) ||
      spec.batch < 1 ||
      spec.batch > 500 ||
      !Array.isArray(spec.types) ||
      typeof spec.handle !== 'function' ||
      typeof spec.resync !== 'function'
    )
      throw new ModuleServiceError('invalid_input');
    if (this.subscriptions.has(key) || this.subscriptions.size >= 64)
      throw new ModuleServiceError('busy');
    const types = parseEventTypes(spec.types.join(','));
    const cancel = new AbortController();
    const done = this.loop(module, spec, types, cancel.signal).catch(() => undefined);
    const subscription = { cancel, done };
    this.subscriptions.set(key, subscription);
    return {
      close: async () => {
        cancel.abort();
        await done;
        if (this.subscriptions.get(key) === subscription) this.subscriptions.delete(key);
      },
    };
  }
  private async callback(
    work: (signal: ModuleSignal) => Promise<void>,
    stop: AbortSignal,
  ): Promise<void> {
    const own = new AbortController();
    const signal = AbortSignal.any([stop, own.signal]);
    const timer = setTimeout(() => {
      own.abort();
    }, this.callbackMs);
    try {
      // Cooperative callbacks stay single-flight even after their deadline. No cursor is saved
      // after cancellation; process shutdown bounds the module drain separately.
      await work(signal);
      signal.throwIfAborted();
    } finally {
      clearTimeout(timer);
    }
  }
  private async loop(
    module: string,
    spec: ChangeSubscription,
    types: readonly string[],
    stop: AbortSignal,
  ): Promise<void> {
    let failures = 0;
    while (!stop.aborted && this.active()) {
      if (!this.enabled.has(module)) {
        await delay(100, undefined, { signal: stop }).catch(() => undefined);
        continue;
      }
      try {
        const cursor = await this.cursors.read(module, spec.consumer);
        const page = await this.log.readInternal({
          after: cursor.epoch === null ? null : cursor.position,
          limit: spec.batch,
          scan: spec.batch,
          repositories: [],
          system: true,
          types,
        });
        let next = page.scannedThrough ?? page.after;
        if (
          cursor.epoch !== null &&
          (cursor.epoch !== page.epoch || cursor.position < page.oldest)
        ) {
          await this.callback(
            (signal) =>
              spec.resync(cursor.epoch !== page.epoch ? 'epoch_changed' : 'cursor_expired', signal),
            stop,
          );
          next = page.head;
        } else if (page.items.length) {
          const events = page.items.map((item) => ({
            id: `${page.epoch}:${String(item.position)}`,
            type: item.type,
            repository: item.repository,
            subject: item.subject,
            data: Object.fromEntries(Object.entries(item.data).map(([k, v]) => [k, json(v)])),
          }));
          await this.callback((signal) => spec.handle(events, signal), stop);
        }
        stop.throwIfAborted();
        if (!this.active()) return;
        if (!(await this.cursors.save(module, spec.consumer, cursor, page.epoch, next)))
          throw new ModuleServiceError('conflict');
        failures = 0;
      } catch {
        failures = Math.min(failures + 1, 8);
      }
      await delay(Math.min(300_000, 1000 * 2 ** failures), undefined, { signal: stop }).catch(
        () => undefined,
      );
    }
  }
  stop(module: string): void {
    for (const [key, subscription] of this.subscriptions)
      if (key.startsWith(`${module}:`)) subscription.cancel.abort();
  }
  close(): void {
    for (const subscription of this.subscriptions.values()) subscription.cancel.abort();
  }
}

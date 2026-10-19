import type { ModuleUnlinkAdmission } from './module-unlink.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ModuleStorageInstance,
  ModuleStorageRegistry,
  StagedCompletion,
  StagedCompletionRegistry,
} from '@proanima/arkvory-extension-api';
import type { StorageBackends, StorageInstance } from './storage-backends.js';
import { fromModule, moduleCall, withSignal } from './module-errors.js';

function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

/** Preserve streaming/backpressure while keeping module errors behind the core boundary. */
async function* readModule(open: () => AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  try {
    yield* open();
  } catch (error) {
    throw fromModule(error);
  }
}

/** Cleanup authority is local to an awaited core collect, never a module-created background task. */
export class ModuleRemoval {
  private readonly current = new AsyncLocalStorage<{ active: boolean; check(): void }>();
  require(): void {
    const grant = this.current.getStore();
    if (!grant?.active) throw new ModuleServiceError('busy');
    grant.check();
  }
  async collect<T>(check: () => void, work: () => Promise<T>): Promise<T> {
    const grant = { active: true, check };
    try {
      return await this.current.run(grant, work);
    } finally {
      grant.active = false;
    }
  }
}

interface Registration {
  readonly instances: Map<string, ModuleStorageInstance>;
  readonly staged: Map<string, StagedCompletion>;
  sealed: boolean;
  active: boolean;
  readonly removal: ModuleRemoval;
}

/** Owns registrations of signed modules, bounded and namespaced, with live write availability. */
export class ModuleStorages {
  private readonly modules = new Map<string, Registration>();
  constructor(
    private readonly backends: StorageBackends,
    private readonly readOnly: boolean,
    private readonly admission?: ModuleUnlinkAdmission,
  ) {}
  private entry(id: string): Registration {
    let entry = this.modules.get(id);
    if (!entry) {
      entry = {
        instances: new Map(),
        staged: new Map(),
        sealed: false,
        active: false,
        removal: new ModuleRemoval(),
      };
      this.modules.set(id, entry);
    }
    return entry;
  }
  removal(id: string): ModuleRemoval {
    return this.entry(id).removal;
  }
  private name(entry: Registration, name: string): void {
    if (entry.sealed || !/^[a-z][a-z0-9-]{0,30}$/.test(name))
      throw new ModuleServiceError('invalid_input');
  }
  storage(id: string): ModuleStorageRegistry {
    const entry = this.entry(id);
    return {
      add: (name, instance) => {
        this.name(entry, name);
        if (entry.instances.size >= 16 || entry.instances.has(name))
          throw new ModuleServiceError('conflict');
        const mode = member(instance, 'mode');
        if (
          (mode !== 'full' && mode !== 'read-only') ||
          typeof member(instance, 'acceptsWrites') !== 'function'
        )
          throw new ModuleServiceError('invalid_input');
        for (const method of [
          'putPart',
          'readParts',
          'put',
          'verify',
          'read',
          'exists',
          'duplicate',
          'collect',
        ])
          if (typeof member(member(instance, 'blobs'), method) !== 'function')
            throw new ModuleServiceError('invalid_input');
        for (const method of ['initialize', 'identity', 'ready', 'checkSpace', 'requireEmpty'])
          if (typeof member(member(instance, 'lifecycle'), method) !== 'function')
            throw new ModuleServiceError('invalid_input');
        entry.instances.set(name, instance);
      },
    };
  }
  staged(id: string): StagedCompletionRegistry {
    const entry = this.entry(id);
    return {
      add: (name, staged) => {
        this.name(entry, name);
        if (
          entry.staged.size >= 16 ||
          entry.staged.has(name) ||
          typeof member(staged, 'compose') !== 'function'
        )
          throw new ModuleServiceError('invalid_input');
        entry.staged.set(name, staged);
      },
    };
  }
  seal(id: string): void {
    const entry = this.entry(id);
    entry.sealed = true;
    for (const name of entry.staged.keys())
      if (!entry.instances.has(name)) throw new ModuleServiceError('invalid_input');
    for (const [name, instance] of entry.instances) {
      const staged = entry.staged.get(name);
      this.backends.register(this.adapt(`${id}.${name}`, entry, instance, staged));
    }
  }
  active(id: string, active: boolean): void {
    this.entry(id).active = active;
  }
  private adapt(
    id: string,
    entry: Registration,
    instance: ModuleStorageInstance,
    staged: StagedCompletion | undefined,
  ): StorageInstance {
    const b = instance.blobs;
    const requireActive = () => {
      if (!entry.active) throw new ModuleServiceError('unavailable');
    };
    const readOnly = this.readOnly;
    return {
      id,
      get enabled() {
        return entry.active;
      },
      get mode() {
        return readOnly ? 'read-only' : instance.mode;
      },
      get acceptsWrites() {
        try {
          const accepting: unknown = instance.acceptsWrites();
          return entry.active && accepting === true;
        } catch {
          return false;
        }
      },
      lifecycle: {
        initialize: () =>
          moduleCall(async () => {
            requireActive();
            await instance.lifecycle.initialize();
          }),
        ready: () =>
          moduleCall(async () => {
            requireActive();
            await instance.lifecycle.ready();
          }),
        identity: (ro) =>
          moduleCall(async () => {
            requireActive();
            return instance.lifecycle.identity(ro);
          }),
        checkSpace: (bytes) => moduleCall(() => instance.lifecycle.checkSpace(bytes)),
        requireEmpty: () => moduleCall(() => instance.lifecycle.requireEmpty()),
      },
      blobs: {
        putPart: (upload, part, source, check) =>
          moduleCall(() => withSignal(check, (signal) => b.putPart(upload, part, source, signal))),
        readParts: (upload, parts) => readModule(() => b.readParts(upload, parts)),
        put: (upload, expected, source, check) =>
          moduleCall(() => withSignal(check, (signal) => b.put(upload, expected, source, signal))),
        verify: (upload, expected, check) =>
          moduleCall(() => withSignal(check, (signal) => b.verify(upload, expected, signal))),
        read: (upload, size, range) => readModule(() => b.read(upload, size, range)),
        exists: (upload, size) => moduleCall(() => b.exists(upload, size)),
        duplicate: (from, to, expected, check) =>
          moduleCall(() => withSignal(check, (signal) => b.duplicate(from, to, expected, signal))),
        collect: (upload, content, check) => {
          if (!this.admission) return Promise.reject(new ModuleServiceError('busy'));
          return this.admission.run((active) =>
            entry.removal.collect(
              () => {
                active();
                check.throwIfAborted();
              },
              () =>
                moduleCall(() => withSignal(check, (signal) => b.collect(upload, content, signal))),
            ),
          );
        },
      },
      ...(staged ? { staged } : {}),
    };
  }
}

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  EXTENSION_API_VERSION,
  MODULE_MANIFEST_FORMAT,
  defineCapability,
} from '@proanima/arkvory-extension-api';
import type {
  ModuleContext,
  ModuleDescriptor,
  ModuleLifecycle,
  ModuleSource,
} from '@proanima/arkvory-extension-api';

/** The value of the test capability `counter`: a shared monotonic counter. */
export interface Counter {
  next(): number;
}

const isCounter = (value: unknown): value is Counter =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'next') === 'function';

export type TestDescriptor = ModuleDescriptor<ModuleContext<unknown>, null>;

/** A module for a host under test, with the source the host plans it under. */
export interface HostedModule {
  readonly descriptor: TestDescriptor;
  readonly source: ModuleSource;
}

export type HostRun =
  | { readonly ok: true; stop(): Promise<void> }
  | { readonly ok: false; readonly codes: readonly string[] };

/** A host under test: plans the modules for one process and starts them, or reports the plan. */
export interface CapabilityHost {
  start(modules: readonly HostedModule[]): Promise<HostRun>;
}

function lifecycle(log: string[], id: string, extra: Partial<ModuleLifecycle> = {}) {
  const instance: ModuleLifecycle = {
    start: () => {
      log.push(`${id}:start`);
      return Promise.resolve();
    },
    drain: () => Promise.resolve(),
    stop: () => {
      log.push(`${id}:stop`);
      return Promise.resolve();
    },
    health: () => ({ status: 'ok', code: null }),
    ...extra,
  };
  return instance;
}

function descriptor(
  id: string,
  fields: Pick<TestDescriptor['manifest'], 'requires' | 'optional' | 'provides'>,
  create: TestDescriptor['create'],
): TestDescriptor {
  return {
    manifest: {
      format: MODULE_MANIFEST_FORMAT,
      id,
      version: '1.0.0',
      extensionApi: `^${EXTENSION_API_VERSION}`,
      kind: 'service',
      publisher: 'testkit',
      core: false,
      roles: ['api'],
      uses: [],
      exposeTo: [],
      resources: null,
      routePrefixes: [],
      metricPrefix: null,
      tablePrefix: null,
      ...fields,
    },
    parseConfig: () => null,
    describeConfig: () => null,
    create,
  };
}

/**
 * `counter-provider` of ADR 0083, N13: provides `counter@<version>`; its value is a counter, or
 * `value` when given (a value of the wrong shape, for the refusal case).
 */
export function counterProvider(log: string[], version: string, value?: unknown): TestDescriptor {
  let count = 0;
  const counter: Counter = { next: () => ++count };
  return descriptor(
    'counter-provider',
    { requires: [], optional: [], provides: [`counter@${version}`] },
    () =>
      lifecycle(log, 'counter-provider', {
        capability: (name) => (name === 'counter' ? (value ?? counter) : undefined),
      }),
  );
}

/**
 * A consumer of `counter` declared `required` or `optional` with `range`, written against the
 * token version `tokenVersion`. On start it records `counter-user:value:<n>`, `:null` or
 * `:error:<code>`.
 */
export function counterConsumer(
  log: string[],
  range: string,
  options: { readonly optional?: boolean; readonly tokenVersion?: string } = {},
): TestDescriptor {
  const token = defineCapability('counter', options.tokenVersion ?? '1.0.0', isCounter);
  const entry = [`counter@${range}`];
  const fields = options.optional
    ? { requires: [], optional: entry, provides: [] }
    : { requires: entry, optional: [], provides: [] };
  return descriptor('counter-user', fields, (context) =>
    lifecycle(log, 'counter-user', {
      start: () => {
        try {
          const counter = context.capabilities.get(token);
          log.push(`counter-user:${counter === null ? 'null' : `value:${String(counter.next())}`}`);
        } catch (error) {
          const code: unknown =
            typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null;
          log.push(`counter-user:error:${String(code)}`);
        }
        return Promise.resolve();
      },
    }),
  );
}

function started(host: CapabilityHost, modules: readonly TestDescriptor[]): Promise<HostRun> {
  return host.start(modules.map((d) => ({ descriptor: d, source: 'signed' })));
}

/**
 * The `capability` contract (ADR 0083, N13): a host gives a consumer the provider's value after
 * the provider started, refuses incompatible versions and wrong shapes, stops consumers first.
 */
export function capabilityContract(
  name: string,
  open: (t: TestContext) => Promise<CapabilityHost>,
): void {
  void test(`${name}: a compatible value reaches the consumer; the consumer stops first`, async (t) => {
    const log: string[] = [];
    const run = await started(await open(t), [
      counterProvider(log, '1.4.0'),
      counterConsumer(log, '^1.2.0', { tokenVersion: '1.2.0' }),
    ]);
    assert.ok(run.ok);
    await run.stop();
    assert.deepEqual(log, [
      'counter-provider:start',
      'counter-user:value:1',
      'counter-user:stop',
      'counter-provider:stop',
    ]);
  });

  void test(`${name}: an incompatible version is refused by the plan`, async (t) => {
    const run = await started(await open(t), [
      counterProvider([], '1.4.0'),
      counterConsumer([], '^2.0.0'),
    ]);
    if (run.ok) assert.fail('the plan must be refused');
    assert.ok(run.codes.includes('requirement_version_mismatch'), run.codes.join());
  });

  void test(`${name}: a value of the wrong shape or an incompatible token is capability_invalid`, async (t) => {
    const log: string[] = [];
    const host = await open(t);
    const wrong = await started(host, [
      counterProvider(log, '1.0.0', { next: 7 }),
      counterConsumer(log, '^1.0.0'),
    ]);
    assert.ok(wrong.ok);
    await wrong.stop();
    assert.ok(log.includes('counter-user:error:capability_invalid'), log.join());
    log.length = 0;
    const token = await started(await open(t), [
      counterProvider(log, '1.4.0'),
      counterConsumer(log, '^1.0.0', { tokenVersion: '2.0.0' }),
    ]);
    assert.ok(token.ok);
    await token.stop();
    assert.ok(log.includes('counter-user:error:capability_invalid'), log.join());
    // A value whose check throws is another shape too: the provider never picks the error.
    log.length = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          throw Object.assign(new Error('chosen by the provider'), { code: 'provider_chosen' });
        },
      },
    );
    const throwing = await started(await open(t), [
      counterProvider(log, '1.0.0', hostile),
      counterConsumer(log, '^1.0.0'),
    ]);
    assert.ok(throwing.ok);
    await throwing.stop();
    assert.ok(log.includes('counter-user:error:capability_invalid'), log.join());
  });

  void test(`${name}: an optional capability without a provider is null`, async (t) => {
    const log: string[] = [];
    const run = await started(await open(t), [counterConsumer(log, '^1.0.0', { optional: true })]);
    assert.ok(run.ok);
    await run.stop();
    assert.deepEqual(log, ['counter-user:null', 'counter-user:stop']);
  });
}

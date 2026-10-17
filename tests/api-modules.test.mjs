import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_API_VERSION, ModuleConfigError } from '../packages/extension-api/dist/index.js';
import {
  ModulePlanError,
  ModuleRuntime,
  planOrThrow,
  prepareModule,
} from '../apps/api/dist/module-host.js';
import { builtinModules, builtinVersion, planApiModules } from '../apps/api/dist/modules.js';

test('the API process plans its built-in modules: UPack and raw are core, the protocols beside', async () => {
  const runtime = planApiModules('api', '1.6.0');
  await runtime.start();
  const plan = runtime.plan;
  assert.deepEqual(plan.startOrder, ['lfs', 'npm', 'oci', 'raw', 'upack']);
  assert.deepEqual(
    plan.modules.map((m) => [m.manifest.id, m.manifest.core, m.enabled, m.source]),
    [
      ['lfs', false, true, 'builtin'],
      ['npm', false, true, 'builtin'],
      ['oci', false, true, 'builtin'],
      ['raw', true, true, 'builtin'],
      ['upack', true, true, 'builtin'],
    ],
  );
  assert.ok(plan.modules.every((m) => m.manifest.version === '1.6.0'));
  assert.equal(plan.extensionApi, EXTENSION_API_VERSION);
  assert.deepEqual(
    runtime.states().map((s) => [s.module.manifest.id, s.running, s.health]),
    plan.startOrder.map((id) => [id, true, { status: 'ok', code: null }]),
  );
  const again = planApiModules('reader', '1.6.0');
  assert.equal(again.plan.fingerprint, plan.fingerprint, 'one plan for every process');
  assert.notEqual(planApiModules('api', '1.6.1').plan.fingerprint, plan.fingerprint);
  await runtime.shutdown(100);
  assert.equal(builtinVersion('dev'), '0.0.0-dev');
  assert.equal(builtinVersion('2.0.1'), '2.0.1');
});

test('built-in modules take no settings yet and refuse any field by its path', () => {
  const [upack] = builtinModules('1.0.0');
  assert.deepEqual(prepareModule(upack, { enabled: true, config: {} }).candidate.config, {});
  assert.throws(
    () => prepareModule(upack, { enabled: true, config: { port: 1 } }),
    (error) => error instanceof ModuleConfigError && error.path === '/port',
  );
  assert.throws(
    () => prepareModule(upack, { enabled: true, config: [] }),
    (error) => error instanceof ModuleConfigError && error.code === 'type',
  );
  // A core module cannot be switched off: the plan refuses before anything starts.
  const prepared = new Map(
    builtinModules('1.0.0').map((d) => [
      d.manifest.id,
      prepareModule(d, { enabled: d.manifest.id !== 'upack', config: undefined }),
    ]),
  );
  const host = {
    coreVersion: '1.0.0',
    extensionApi: EXTENSION_API_VERSION,
    reservedRoutePrefixes: ['/api/v1/'],
    sha256: () => '0'.repeat(64),
  };
  assert.throws(
    () => planOrThrow(prepared, host),
    (error) =>
      error instanceof ModulePlanError &&
      error.problems.some((p) => p.code === 'core_disabled' && p.module === 'upack'),
  );
});

/** A test module that records what the core calls on it. */
function recorder(log, id, behaviour = {}) {
  return {
    manifest: {
      format: 1,
      id,
      version: '1.0.0',
      extensionApi: `^${EXTENSION_API_VERSION}`,
      kind: 'event-sink',
      core: false,
      roles: behaviour.roles ?? ['api'],
      requires: behaviour.requires ?? [],
      provides: behaviour.provides ?? [],
      routePrefixes: [],
      metricPrefix: null,
      tablePrefix: null,
    },
    parseConfig: () => ({}),
    describeConfig: () => ({}),
    create: () => ({
      start: async () => {
        log.push(`start ${id}`);
        if (behaviour.start) await behaviour.start();
      },
      drain: async (budget) => {
        log.push(`drain ${id}`);
        if (behaviour.drain) await behaviour.drain(budget);
      },
      stop: async () => {
        log.push(`stop ${id}`);
        if (behaviour.stop) await behaviour.stop();
      },
      health: behaviour.health ?? (() => ({ status: 'ok', code: null })),
    }),
  };
}

function planned(descriptors) {
  const prepared = new Map(descriptors.map((d) => [d.manifest.id, prepareModule(d)]));
  const host = {
    coreVersion: '1.0.0',
    extensionApi: EXTENSION_API_VERSION,
    reservedRoutePrefixes: [],
    sha256: () => 'f'.repeat(64),
  };
  return { plan: planOrThrow(prepared, host), prepared };
}
const runtimeOf = ({ plan, prepared }, role = 'api') =>
  new ModuleRuntime(plan, prepared, { role, context: {} });
const run = async (parts, role = 'api') => {
  const runtime = runtimeOf(parts, role);
  await runtime.start();
  return runtime;
};

test('modules start in plan order in their own roles and stop in reverse', async () => {
  const log = [];
  const runtime = await run(
    planned([
      recorder(log, 'sink', { requires: ['keys'] }),
      recorder(log, 'keys', { provides: ['keys'], roles: ['api', 'worker'] }),
      recorder(log, 'elsewhere', { roles: ['worker'] }),
    ]),
  );
  assert.deepEqual(log, ['start keys', 'start sink']);
  const states = Object.fromEntries(runtime.states().map((s) => [s.module.manifest.id, s]));
  assert.equal(states.elsewhere.running, false);
  assert.equal(states.elsewhere.health, null);
  await Promise.all([runtime.shutdown(1000), runtime.shutdown(1000)]);
  await runtime.shutdown(1000);
  assert.deepEqual(log.slice(2), ['drain sink', 'drain keys', 'stop sink', 'stop keys']);
});

test('a failed start stops what started, the failed module included, in reverse', async () => {
  const log = [];
  const failure = new Error('cannot start');
  const parts = planned([
    recorder(log, 'first'),
    recorder(log, 'second', {
      start: () => Promise.reject(failure),
      stop: () => Promise.reject(new Error('stop fails too')),
    }),
    recorder(log, 'third'),
  ]);
  const runtime = runtimeOf(parts);
  await assert.rejects(runtime.start(), (error) => {
    // The failure of the rollback is kept beside the cause, not lost.
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, failure);
    assert.deepEqual(
      error.errors.map((e) => e.message),
      ['cannot start', 'stop fails too'],
    );
    return true;
  });
  assert.deepEqual(log, ['start first', 'start second', 'stop second', 'stop first']);
  assert.ok(runtime.states().every((s) => !s.running));
  await runtime.shutdown(100);
  assert.equal(log.length, 4, 'a rolled back module is not stopped again');
  await assert.rejects(runtime.start(), /once/);

  log.length = 0;
  const clean = planned([
    recorder(log, 'first'),
    recorder(log, 'second', { start: () => Promise.reject(failure) }),
  ]);
  await assert.rejects(run(clean), (error) => error === failure);
  const cancelled = runtimeOf(parts);
  cancelled.cancelStart();
  log.length = 0;
  await assert.rejects(cancelled.start(), { name: 'AbortError' });
  assert.deepEqual(log, []);
});

test('a stop while modules start cancels the start and settles it before close returns', async () => {
  const log = [];
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  // The last module ignores the cancellation and finishes its start anyway.
  const runtime = runtimeOf(
    planned([recorder(log, 'first'), recorder(log, 'second', { start: () => slow })]),
  );
  const starting = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ['start first', 'start second']);
  let closed = false;
  const closing = runtime.shutdown(100).then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false, 'close waits for the start to settle');
  release();
  await assert.rejects(starting, { name: 'AbortError' });
  await closing;
  // Rolled back by the start itself, so nothing is drained and nothing is stopped twice.
  assert.deepEqual(log, ['start first', 'start second', 'stop second', 'stop first']);
  assert.ok(runtime.states().every((s) => !s.running));
});

test('an asynchronous health report is invalid and its rejection does not escape', async () => {
  const escaped = [];
  const listener = (reason) => escaped.push(reason);
  process.on('unhandledRejection', listener);
  try {
    const runtime = await run(
      planned([recorder([], 'async', { health: () => Promise.reject(new Error('later')) })]),
    );
    assert.deepEqual(runtime.states()[0].health, { status: 'failed', code: 'health_invalid' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(escaped, []);
    await runtime.shutdown(100);
  } finally {
    process.off('unhandledRejection', listener);
  }
});

test('shutdown bounds the drain, stops every module and reports failures together', async () => {
  const log = [];
  const runtime = await run(
    planned([
      recorder(log, 'hangs', { drain: () => new Promise(() => undefined) }),
      recorder(log, 'breaks', {
        drain: () => Promise.reject(new Error('drain failed')),
        stop: () => Promise.reject(new Error('stop failed')),
      }),
      recorder(log, 'healthless', {
        health: () => {
          throw new Error('no health');
        },
      }),
      recorder(log, 'odd', { health: () => ({ status: 'fine', code: null }) }),
    ]),
  );
  const health = Object.fromEntries(
    runtime.states().map((s) => [s.module.manifest.id, s.health.code]),
  );
  assert.equal(health.healthless, 'health_unavailable');
  assert.equal(health.odd, 'health_invalid');
  const started = performance.now();
  await assert.rejects(runtime.shutdown(50), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(
      error.errors.map((e) => e.message),
      ['drain failed', 'stop failed'],
    );
    return true;
  });
  assert.ok(performance.now() - started < 5000, 'a hanging drain does not hold the close');
  assert.deepEqual(
    log.filter((line) => line.startsWith('stop')),
    ['stop odd', 'stop healthless', 'stop hangs', 'stop breaks'],
  );
});

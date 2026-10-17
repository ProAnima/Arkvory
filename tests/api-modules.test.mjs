import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_API_VERSION, ModuleConfigError } from '../packages/extension-api/dist/index.js';
import {
  MetricsRegistry,
  ModulePlanError,
  builtinModules,
  builtinVersion,
  parseModuleSelections,
  planOrThrow,
  prepareModule,
} from '../packages/infrastructure/dist/index.js';
import { ModuleRuntime } from '../apps/api/dist/module-host.js';
import { planApiModules } from '../apps/api/dist/modules.js';
import { ModuleTelemetry } from '../apps/api/dist/module-telemetry.js';
import { moduleMetrics } from '../apps/api/dist/module-metrics.js';

test('the API process plans its built-in modules: UPack, raw and local storage are core, the protocols beside', async () => {
  const runtime = planApiModules('api', '1.6.0');
  await runtime.start();
  const plan = runtime.plan;
  assert.deepEqual(plan.startOrder, ['lfs', 'local-storage', 'npm', 'oci', 'raw', 'upack']);
  assert.deepEqual(
    plan.modules.map((m) => [m.manifest.id, m.manifest.core, m.enabled, m.source]),
    [
      ['lfs', false, true, 'builtin'],
      ['local-storage', true, true, 'builtin'],
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
  // Another release with the same modules: another build, but the processes still agree.
  const next = planApiModules('api', '1.6.1').plan;
  assert.notEqual(next.fingerprint, plan.fingerprint);
  assert.equal(next.compatibilityFingerprint, plan.compatibilityFingerprint);
  assert.equal(
    planApiModules('api', 'dev').plan.compatibilityFingerprint,
    plan.compatibilityFingerprint,
  );
  await runtime.shutdown(100);
  assert.equal(builtinVersion('dev'), '0.0.0-dev');
  assert.equal(builtinVersion('2.0.1'), '2.0.1');
});

test('built-in protocols take no settings yet and refuse any field by its path', () => {
  const upack = builtinModules('1.0.0').find((d) => d.manifest.id === 'upack');
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
    services: [],
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
      publisher: 'proanimastudio',
      core: behaviour.core ?? false,
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
    services: [],
  };
  return { plan: planOrThrow(prepared, host), prepared };
}
const runtimeOf = ({ plan, prepared }, role = 'api', context = () => ({})) =>
  new ModuleRuntime(plan, prepared, { role, context });
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

test('the modules file disables protocols beside /api/v1 and changes the plan of every process', () => {
  const choices = parseModuleSelections({
    format: 1,
    modules: { npm: { enabled: false }, oci: { enabled: true, config: {} } },
  });
  const runtime = planApiModules('reader', '1.6.0', choices);
  assert.deepEqual(
    runtime.planned().map((m) => m.manifest.id),
    ['lfs', 'local-storage', 'oci', 'raw', 'upack'],
  );
  assert.equal(runtime.plan.modules.find((m) => m.manifest.id === 'npm').enabled, false);
  const defaults = planApiModules('reader', '1.6.0').plan.fingerprint;
  assert.notEqual(runtime.plan.fingerprint, defaults);
  assert.notEqual(
    runtime.plan.compatibilityFingerprint,
    planApiModules('reader', '1.6.1').plan.compatibilityFingerprint,
    'a disabled module is a disagreement in any release',
  );
  // Naming a module with its defaults keeps the plan of an installation without a file.
  const same = parseModuleSelections({ format: 1, modules: { npm: { enabled: true } } });
  assert.equal(planApiModules('api', '1.6.0', same).plan.fingerprint, defaults);
  assert.equal(planApiModules('api', '1.6.0', choices).plan.fingerprint, runtime.plan.fingerprint);
  const refuse = (modules, pattern) =>
    assert.throws(
      () => planApiModules('api', '1.6.0', parseModuleSelections({ format: 1, modules })),
      pattern,
    );
  refuse(
    { upack: { enabled: false } },
    (error) =>
      error instanceof ModulePlanError && error.problems.some((p) => p.code === 'core_disabled'),
  );
  refuse({ teleport: { enabled: true } }, /Invalid ARKVORY_MODULES_FILE: unknown module teleport/);
  refuse(
    { npm: { enabled: true, config: { port: 1 } } },
    /Invalid ARKVORY_MODULES_FILE: unknown_field \/modules\/npm\/config\/port$/,
  );
});

test('the modules file is read field by field and never echoes a value', () => {
  const invalid = (document, pattern) =>
    assert.throws(() => parseModuleSelections(document), pattern);
  assert.equal(parseModuleSelections({ format: 1 }).size, 0);
  invalid(null, /Invalid ARKVORY_MODULES_FILE: \//);
  invalid({ format: 2, modules: {} }, /: \/format$/);
  invalid({ format: '1', modules: {} }, /: \/format$/);
  invalid({ format: 1, modules: [] }, /: \/modules$/);
  invalid({ format: 1, extra: true }, /: unknown field \/extra$/);
  invalid({ format: 1, modules: { npm: { enabled: 'no' } } }, /: \/modules\/npm\/enabled$/);
  invalid({ format: 1, modules: { npm: {} } }, /: \/modules\/npm\/enabled$/);
  invalid(
    { format: 1, modules: { npm: { enabled: true, mode: 1 } } },
    /field \/modules\/npm\/mode$/,
  );
  const secret = '/etc/Secret Path/key';
  for (const document of [
    { format: 1, modules: { [secret]: { enabled: true } } },
    { format: 1, modules: { npm: { enabled: true, [secret]: 1 } } },
  ])
    assert.throws(
      () => parseModuleSelections(document),
      (error) => !error.message.includes(secret) && /ARKVORY_MODULES_FILE/.test(error.message),
    );
  const many = Object.fromEntries(
    Array.from({ length: 257 }, (_, i) => [`m${String(i)}`, { enabled: true }]),
  );
  invalid({ format: 1, modules: many }, /too many modules/);
});

test('each module gets its own context: role, source, mode, the stop signal, log and metrics', async () => {
  const log = [];
  const contexts = [];
  const parts = planned([recorder(log, 'sink')]);
  const runtime = runtimeOf(parts, 'reader', (module, signal) => {
    contexts.push({ id: module.manifest.id, signal });
    return { role: 'reader', id: module.manifest.id };
  });
  await runtime.start();
  await runtime.shutdown(100);
  // `sink` runs only in `api`: a reader creates nothing.
  assert.deepEqual(contexts, []);
  const writer = runtimeOf(planned([recorder(log, 'sink')]), 'api', (module, signal) => {
    contexts.push({ id: module.manifest.id, signal });
    return { id: module.manifest.id };
  });
  await writer.start();
  assert.deepEqual(
    contexts.map((c) => c.id),
    ['sink'],
  );
  assert.equal(contexts[0].signal.aborted, false);
  await writer.shutdown(100);
  assert.equal(contexts[0].signal.aborted, true, 'the signal aborts when the process stops');

  const api = planApiModules('reader', '1.6.0');
  assert.deepEqual(
    api.planned().map((m) => m.manifest.publisher),
    Array.from({ length: 6 }, () => 'proanimastudio'),
  );
});

test('a failed core module or required provider takes the process out of readiness', async () => {
  let keys = { status: 'ok', code: null };
  let optional = { status: 'ok', code: null };
  const runtime = await run(
    planned([
      recorder([], 'keys', { provides: ['keys'], health: () => keys }),
      recorder([], 'user', { requires: ['keys'] }),
      recorder([], 'extra', { health: () => optional }),
    ]),
  );
  assert.equal(runtime.blockingFailure(), null);
  optional = { status: 'failed', code: 'broken' };
  assert.equal(runtime.blockingFailure(), null, 'an optional module may fail');
  keys = { status: 'degraded', code: 'slow' };
  assert.equal(runtime.blockingFailure(), null, 'degraded keeps the process ready');
  keys = { status: 'failed', code: 'broken' };
  assert.equal(runtime.blockingFailure(), 'keys');
  await runtime.shutdown(100);
  const core = await run(
    planned([
      recorder([], 'heart', { core: true, health: () => ({ status: 'failed', code: 'x' }) }),
    ]),
  );
  assert.equal(core.blockingFailure(), 'heart');
  await core.shutdown(100);
});

test('module metrics: info and up per running module, own series only under the prefix', async () => {
  let health = { status: 'ok', code: null };
  const parts = planned([
    recorder([], 'alpha', { health: () => health }),
    recorder([], 'idle', { roles: ['worker'] }),
  ]);
  const runtime = await run(parts);
  const records = [];
  const telemetry = new ModuleTelemetry({ write: (record) => records.push(record) }, () => 0);
  const registry = new MetricsRegistry();
  moduleMetrics(runtime, telemetry).register(registry);
  let page = registry.render();
  assert.match(
    page,
    /^arkvory_module_info\{module="alpha",kind="event-sink",source="builtin"\} 1$/m,
  );
  assert.match(page, /^arkvory_module_up\{module="alpha"\} 1$/m);
  assert.doesNotMatch(page, /module="idle"/);
  health = { status: 'degraded', code: 'slow' };
  assert.match(registry.render(), /^arkvory_module_up\{module="alpha"\} 0$/m);

  const own = { id: 'probe', metricPrefix: 'arkvory_probe_' };
  const metrics = telemetry.metrics(own);
  const counter = metrics.counter('arkvory_probe_checks_total', 'Checks.');
  counter.add();
  counter.add(2);
  metrics.gauge('arkvory_probe_depth', 'Depth.').set(-3);
  page = registry.render();
  assert.match(page, /^arkvory_probe_checks_total 3$/m);
  assert.match(page, /^arkvory_probe_depth -3$/m);
  assert.throws(() => metrics.counter('arkvory_http_requests_total', 'x'), TypeError);
  assert.throws(() => metrics.counter('arkvory_probe_checks_total', 'again'), TypeError);
  assert.throws(() => metrics.gauge('arkvory_probe_', 'prefix alone'), TypeError);
  assert.throws(
    () => telemetry.metrics({ id: 'quiet', metricPrefix: null }).gauge('x', 'y'),
    TypeError,
  );
  assert.throws(() => counter.add(-1), RangeError);
  await runtime.shutdown(100);
});

test('module logs are checked, prefixed with the module and limited per window', () => {
  const records = [];
  let now = 0;
  const telemetry = new ModuleTelemetry({ write: (record) => records.push(record) }, () => now);
  const log = telemetry.log({ id: 'probe' });
  log.write('info', { code: 'cache.warmed', subject: 'releases', count: 3, durationMs: 12 });
  assert.deepEqual(records[0], {
    level: 'info',
    component: 'module',
    code: 'module.cache.warmed',
    module: 'probe',
    subject: 'releases',
    durationMs: 12,
    count: 3,
  });
  for (const record of [
    { code: 'Bad Code' },
    { code: 'ok', subject: 'https://host/secret' },
    { code: 'ok', subject: '/etc/passwd' },
    { code: 'ok', count: Number.NaN },
  ]) {
    log.write('warning', record);
    assert.deepEqual(records.at(-1), {
      level: 'warning',
      component: 'module',
      code: 'module.log_invalid',
      module: 'probe',
    });
  }
  // A level outside the contract would be written past the process log level.
  for (const level of ['fatal', 'WARNING', undefined]) {
    log.write(level, { code: 'ok' });
    assert.deepEqual(records.at(-1), {
      level: 'warning',
      component: 'module',
      code: 'module.log_invalid',
      module: 'probe',
    });
  }
  assert.ok(records.every((r) => !JSON.stringify(r).includes('secret')));
  records.length = 0;
  for (let i = 0; i < 60; i++) log.write('info', { code: 'tick' });
  assert.equal(records.filter((r) => r.code === 'module.tick').length, 42);
  assert.equal(records.filter((r) => r.code === 'module.log_suppressed').length, 1);
  now = 10_000;
  log.write('info', { code: 'tick' });
  assert.equal(records.at(-1).code, 'module.tick', 'a new window writes again');
});

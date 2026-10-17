import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_API_VERSION, ModuleConfigError } from '../packages/extension-api/dist/index.js';
import {
  ModulePlanError,
  ModuleRuntime,
  planOrThrow,
  prepareModule,
} from '../apps/api/dist/module-host.js';
import { builtinModules, builtinVersion, startApiModules } from '../apps/api/dist/modules.js';

const live = () => new AbortController().signal;

test('the API process plans its built-in modules: UPack and raw are core, the protocols beside', async () => {
  const runtime = await startApiModules('api', '1.6.0', live());
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
  const again = await startApiModules('reader', '1.6.0', live());
  assert.equal(again.plan.fingerprint, plan.fingerprint, 'one plan for every process');
  assert.notEqual(
    (await startApiModules('api', '1.6.1', live())).plan.fingerprint,
    plan.fingerprint,
  );
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
const run = ({ plan, prepared }, signal = live(), role = 'api') =>
  ModuleRuntime.start(plan, prepared, { role, context: {}, signal });

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
  await assert.rejects(run(parts), (error) => error === failure);
  assert.deepEqual(log, ['start first', 'start second', 'stop second', 'stop first']);
  const stopped = new AbortController();
  stopped.abort();
  log.length = 0;
  await assert.rejects(run(parts, stopped.signal), { name: 'AbortError' });
  assert.deepEqual(log, []);
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

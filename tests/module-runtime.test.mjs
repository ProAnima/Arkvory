import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_API_VERSION } from '../packages/extension-api/dist/index.js';
import {
  MetricsRegistry,
  ModuleLoadError,
  planOrThrow,
} from '../packages/infrastructure/dist/index.js';
import { ModuleRuntime } from '../apps/api/dist/module-host.js';
import { ModuleTelemetry } from '../apps/api/dist/module-telemetry.js';
import { moduleMetrics } from '../apps/api/dist/module-metrics.js';
import { describeModules } from '../apps/api/dist/module-routes.js';

const host = {
  coreVersion: '1.0.0',
  extensionApi: EXTENSION_API_VERSION,
  reservedRoutePrefixes: [],
  sha256: () => 'f'.repeat(64),
  services: [],
};

/**
 * A signed module as the loader prepares it; `behaviour.create` replaces its factory, as the
 * loader does for code that failed to load in this process.
 */
function signed(log, id, behaviour = {}) {
  const manifest = {
    format: 1,
    id,
    version: '1.0.0',
    extensionApi: `^${EXTENSION_API_VERSION}`,
    kind: 'event-sink',
    publisher: 'proanimastudio',
    core: false,
    roles: ['api'],
    requires: behaviour.requires ?? [],
    provides: behaviour.provides ?? [],
    routePrefixes: [],
    metricPrefix: null,
    tablePrefix: null,
  };
  const create =
    behaviour.create ??
    (() => ({
      start: async (signal) => {
        log.push(`start ${id}`);
        if (behaviour.start) await behaviour.start(signal);
      },
      drain: async () => {
        log.push(`drain ${id}`);
      },
      stop: async () => {
        log.push(`stop ${id}`);
      },
      health: () => ({ status: 'ok', code: null }),
    }));
  return [
    id,
    {
      candidate: {
        manifest,
        source: 'signed',
        packageSha256: 'a'.repeat(64),
        enabled: true,
        config: null,
      },
      dataClass: behaviour.dataClass ?? 'none',
      create,
    },
  ];
}

function runtimeOf(entries, refused = [], budget = 30_000) {
  const prepared = new Map(entries);
  const plan = planOrThrow(prepared, host);
  return new ModuleRuntime(plan, prepared, { role: 'api', context: () => ({}) }, refused, budget);
}

const states = (runtime) =>
  Object.fromEntries(runtime.states().map((s) => [s.module.manifest.id, [s.running, s.health]]));

test('a signed module that fails to start fails alone; its consumers are not created', async () => {
  const log = [];
  const runtime = runtimeOf([
    signed(log, 'feed', { provides: ['feed@1.0.0'], start: () => Promise.reject(new Error('no')) }),
    signed(log, 'digest', { requires: ['feed@^1.0.0'], provides: ['digest@1.0.0'] }),
    signed(log, 'report', { requires: ['digest@^1.0.0'] }),
    signed(log, 'alone'),
  ]);
  await runtime.start();
  assert.deepEqual(states(runtime), {
    alone: [true, { status: 'ok', code: null }],
    digest: [false, { status: 'failed', code: 'requirement_failed' }],
    feed: [false, { status: 'failed', code: 'start_failed' }],
    report: [false, { status: 'failed', code: 'requirement_failed' }],
  });
  // The failed module was stopped right away; the healthy one runs until shutdown.
  assert.deepEqual(log, ['start alone', 'start feed', 'stop feed']);
  assert.equal(runtime.blockingFailure(), 'digest', 'an enabled module needs what failed');
  await runtime.shutdown(100);
  assert.deepEqual(log.slice(3), ['drain alone', 'stop alone']);
});

test('code that did not load, a create that throws and a start beyond its budget fail alone', async () => {
  const log = [];
  const runtime = runtimeOf(
    [
      signed(log, 'missing', {
        create: () => {
          throw new ModuleLoadError('import_failed');
        },
      }),
      signed(log, 'broken', {
        create: () => {
          throw new Error('cannot create');
        },
      }),
      signed(log, 'slow', {
        // Ignores the abort of its own budget on purpose: the host stops waiting regardless.
        start: () => new Promise(() => undefined),
      }),
    ],
    [],
    50,
  );
  await runtime.start();
  assert.deepEqual(states(runtime), {
    broken: [false, { status: 'failed', code: 'create_failed' }],
    missing: [false, { status: 'failed', code: 'import_failed' }],
    slow: [false, { status: 'failed', code: 'start_timeout' }],
  });
  assert.deepEqual(log, ['start slow', 'stop slow']);
  assert.equal(runtime.blockingFailure(), null, 'none of them is needed by another');
  await runtime.shutdown(100);
});

test('a module that stores published bytes never takes the process out of readiness', async () => {
  const runtime = runtimeOf([
    signed([], 'layout', {
      provides: ['blobs@1.0.0'],
      dataClass: 'layout',
      start: () => Promise.reject(new Error('no')),
    }),
    signed([], 'user', { requires: ['blobs@^1.0.0'] }),
  ]);
  await runtime.start();
  assert.deepEqual(states(runtime).layout, [false, { status: 'failed', code: 'start_failed' }]);
  assert.equal(runtime.blockingFailure(), null);
  await runtime.shutdown(100);
});

test('the cancellation of the process start still stops the start', async () => {
  const runtime = runtimeOf([
    signed([], 'waiting', {
      start: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    }),
  ]);
  const started = runtime.start();
  runtime.cancelStart();
  await assert.rejects(started, { name: 'AbortError' });
});

const refusal = (id, overrides = {}) => ({
  id,
  version: '2.0.0',
  kind: null,
  roles: [],
  enabled: true,
  status: 'failed',
  code: 'file_mismatch',
  ...overrides,
});

test('refused modules are listed and measured; an enabled one missing a requirement blocks', async () => {
  const log = [];
  const runtime = runtimeOf(
    [signed(log, 'beta'), signed(log, 'zeta', { start: () => Promise.reject(new Error('x')) })],
    [
      refusal('alpha'),
      refusal('gamma', {
        status: 'revoked',
        code: 'unsafe_read',
        kind: 'event-sink',
        roles: ['api'],
      }),
      refusal('omega', { enabled: false, status: 'unavailable', code: 'module_unavailable' }),
    ],
  );
  await runtime.start();
  const described = describeModules(runtime);
  assert.deepEqual(
    described.modules.map((m) => [m.id, m.kind, m.source, m.enabled, m.running, m.health]),
    [
      ['alpha', 'unknown', 'signed', true, false, { status: 'failed', code: 'file_mismatch' }],
      ['beta', 'event-sink', 'signed', true, true, { status: 'ok', code: null }],
      ['gamma', 'event-sink', 'signed', true, false, { status: 'revoked', code: 'unsafe_read' }],
      [
        'omega',
        'unknown',
        'signed',
        false,
        false,
        { status: 'unavailable', code: 'module_unavailable' },
      ],
      ['zeta', 'event-sink', 'signed', true, false, { status: 'failed', code: 'start_failed' }],
    ],
  );
  assert.equal(runtime.blockingFailure(), null);
  const registry = new MetricsRegistry();
  moduleMetrics(runtime, new ModuleTelemetry({ write: () => undefined }, () => 0)).register(
    registry,
  );
  const text = registry.render();
  assert.match(text, /^arkvory_module_up\{module="beta"\} 1$/m);
  assert.match(text, /^arkvory_module_up\{module="zeta"\} 0$/m);
  assert.match(text, /^arkvory_module_up\{module="alpha"\} 0$/m);
  assert.match(text, /^arkvory_module_info\{module="alpha",kind="unknown",source="signed"\} 1$/m);
  assert.doesNotMatch(text, /module="omega"/, 'a disabled refused module has no series');
  await runtime.shutdown(100);
  const blocked = runtimeOf([], [refusal('consumer', { code: 'missing_requirement' })]);
  assert.equal(blocked.blockingFailure(), 'consumer');
  const disabled = runtimeOf(
    [],
    [refusal('consumer', { code: 'missing_requirement', enabled: false })],
  );
  assert.equal(disabled.blockingFailure(), null);
});

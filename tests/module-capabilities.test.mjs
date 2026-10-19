import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_API_VERSION, planModules } from '../packages/extension-api/dist/index.js';
import { capabilityContract } from '../packages/extension-testkit/dist/index.js';
import { ModuleRuntime } from '../apps/api/dist/module-host.js';

// The API process's module runtime as the host of capability values (ADR 0083, N13) and of the
// freeze of module data before a copy (N6).
const host = {
  coreVersion: '1.0.0',
  extensionApi: EXTENSION_API_VERSION,
  reservedRoutePrefixes: [],
  sha256: () => 'f'.repeat(64),
  services: ['data-directory'],
};

function prepared(modules) {
  return new Map(
    modules.map(({ descriptor, source }) => [
      descriptor.manifest.id,
      {
        candidate: {
          manifest: descriptor.manifest,
          source,
          packageSha256: source === 'builtin' ? null : 'a'.repeat(64),
          enabled: true,
          config: null,
        },
        dataClass: source === 'builtin' ? null : 'none',
        create: (context) => descriptor.create(context, null),
      },
    ]),
  );
}

function runtimeOf(modules, budget = 30_000) {
  const entries = prepared(modules);
  const result = planModules(
    [...entries.values()].map((m) => m.candidate),
    host,
  );
  if (!result.ok) return { ok: false, codes: result.problems.map((p) => p.code) };
  const context = (_module, signal, capabilities) => ({ signal, capabilities, services: {} });
  const runtime = new ModuleRuntime(result.plan, entries, { role: 'api', context }, [], budget);
  return { ok: true, runtime };
}

capabilityContract('API module runtime', async () => ({
  async start(modules) {
    const built = runtimeOf(modules);
    if (!built.ok) return built;
    await built.runtime.start();
    return { ok: true, stop: () => built.runtime.shutdown(1000) };
  },
}));

function dataModule(id, behaviour = {}) {
  const manifest = {
    format: 1,
    id,
    version: '1.0.0',
    extensionApi: `^${EXTENSION_API_VERSION}`,
    kind: 'service',
    publisher: 'proanimastudio',
    core: false,
    roles: ['api'],
    uses: behaviour.uses ?? ['data-directory'],
    requires: [],
    provides: [],
    routePrefixes: [],
    metricPrefix: null,
    tablePrefix: null,
  };
  return {
    source: 'signed',
    descriptor: {
      manifest,
      parseConfig: () => null,
      describeConfig: () => null,
      create: () => ({
        start: () => Promise.resolve(),
        drain: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        health: () => ({ status: 'ok', code: null }),
        ...behaviour.hooks,
      }),
    },
  };
}

test('a module without freeze, or whose freeze fails or overruns, is copied fuzzy', async () => {
  const log = [];
  const hooks = (id, freeze) => ({
    freeze: async (deadline) => {
      log.push(`freeze ${id} ${String(deadline)}`);
      await freeze();
    },
    thaw: async () => {
      log.push(`thaw ${id}`);
    },
  });
  const built = runtimeOf([
    dataModule('held', { hooks: hooks('held', () => Promise.resolve()) }),
    dataModule('broken', { hooks: hooks('broken', () => Promise.reject(new Error('no'))) }),
    dataModule('slow', { hooks: hooks('slow', () => new Promise(() => undefined)) }),
    dataModule('plain'),
    dataModule('stateless', { uses: [], hooks: hooks('stateless', () => Promise.resolve()) }),
  ]);
  assert.ok(built.ok);
  await built.runtime.start();
  const frozen = await built.runtime.freezeData(50);
  assert.deepEqual(Object.fromEntries(frozen.consistency), {
    broken: 'fuzzy',
    held: 'consistent',
    plain: 'fuzzy',
    slow: 'fuzzy',
  });
  await frozen.thaw();
  await frozen.thaw();
  // Every module asked to freeze is told to resume once, in reverse order; others never.
  assert.deepEqual(log, [
    'freeze broken 50',
    'freeze held 50',
    'freeze slow 50',
    'thaw slow',
    'thaw held',
    'thaw broken',
  ]);
  await built.runtime.shutdown(100);
});

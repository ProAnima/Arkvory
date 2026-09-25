import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, matchesGlob } from 'node:path';
import ts from 'typescript';
import { inspectCompilerOptions } from './compiler.mjs';

export async function filesUnder(root, folder) {
  const result = [];
  for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
    const path = folder + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Source inventory cannot follow symlinks: ${path}`);
    if (entry.isDirectory()) result.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
export function planGates(registry, selected) {
  const result = [],
    done = new Set(),
    active = new Set();
  function visit(name) {
    if (done.has(name)) return;
    if (active.has(name)) throw new Error(`Gate dependency cycle: ${name}`);
    if (registry.profiles[name]) {
      active.add(name);
      registry.profiles[name].forEach(visit);
      active.delete(name);
      return;
    }
    const task = registry.tasks[name];
    if (!task) throw new Error(`Unknown gate: ${name}`);
    if (
      !Number.isInteger(task.timeoutSeconds) ||
      task.timeoutSeconds < 1 ||
      task.timeoutSeconds > 1800
    )
      throw new Error(`Invalid gate timeout: ${name}`);
    active.add(name);
    task.needs.forEach(visit);
    active.delete(name);
    done.add(name);
    result.push(name);
  }
  selected.forEach(visit);
  return result;
}
export function gateEntries(task, files) {
  if (task.pattern) return files.filter((file) => matchesGlob(file, task.pattern));
  return task.entries ?? [];
}
export function testInventory(registry, analyses) {
  const problems = [],
    roots = new Set(),
    tasks = Object.values(registry.tasks),
    files = [...analyses.keys()];
  for (const task of tasks) {
    if (!task.pattern && !task.entries) continue;
    const entries = gateEntries(task, files);
    if (!entries.length) problems.push(`Empty test gate: ${task.pattern ?? task.entries}`);
    entries.forEach((f) => roots.add(f));
  }
  for (const path of registry.spawnedHelpers) roots.add(path);
  const reached = new Set();
  function visit(file) {
    if (reached.has(file)) return;
    reached.add(file);
    const analysis = analyses.get(file);
    if (!analysis) {
      problems.push(`Missing registered test/helper: ${file}`);
      return;
    }
    for (const spec of analysis.imports)
      if (spec.startsWith('.')) {
        const imported = relative('.', resolve(dirname(file), spec)).replaceAll('\\', '/');
        if (imported.startsWith('tests/') && imported.endsWith('.mjs')) visit(imported);
      }
  }
  roots.forEach(visit);
  for (const file of files)
    if (file.startsWith('tests/') && file.endsWith('.mjs') && !reached.has(file))
      problems.push(`Test outside every gate/import graph: ${file}`);
  return problems;
}
export async function inspectWorkspaces(root, architecture) {
  const problems = [],
    registered = new Set(architecture.units.map((u) => u.path)),
    names = new Map();
  for (const group of ['apps', 'packages'])
    for (const entry of await readdir(resolve(root, group), { withFileTypes: true }))
      if (entry.isDirectory() && !registered.has(group + '/' + entry.name))
        problems.push(`Unregistered workspace: ${group}/${entry.name}`);
  const preceding = new Set();
  for (const unit of architecture.units) {
    if (preceding.has(unit.path) || unit.allowed.some((a) => !preceding.has(a)))
      problems.push(`Invalid build order/dependencies: ${unit.path}`);
    preceding.add(unit.path);
    const manifest = JSON.parse(await readFile(resolve(root, unit.path, 'package.json'), 'utf8'));
    names.set(manifest.name, unit.path);
    if (
      Object.keys(manifest.exports ?? {}).some((k) => k.startsWith('.')) ||
      manifest.exports?.['depot-source'] !== './src/index.ts' ||
      manifest.exports?.import !== './dist/index.js'
    )
      problems.push(`${unit.path}: only the public index may be exported`);
    for (const config of ['tsconfig.json', 'tsconfig.build.json']) {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        resolve(root, unit.path, config),
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () =>
            problems.push(`${unit.path}: invalid tsconfig`),
        },
      );
      problems.push(
        ...inspectCompilerOptions(
          parsed?.options,
          unit.path + '/' + config,
          /^packages\/(domain|application|contracts)$/.test(unit.path),
        ),
      );
      if (parsed?.errors.length) problems.push(`${unit.path}: tsconfig errors`);
    }
  }
  for (const unit of architecture.units) {
    const manifest = JSON.parse(await readFile(resolve(root, unit.path, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
      if (names.has(name) && !unit.allowed.includes(names.get(name)))
        problems.push(`${unit.path}: manifest declares forbidden dependency ${name}`);
  }
  return problems;
}

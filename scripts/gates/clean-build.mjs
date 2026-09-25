import { lstat, realpath, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export async function cleanBuild(root, units) {
  const workspace = await realpath(root);
  const paths = units.map((unit) => {
    if (!/^(apps|packages)\/[a-z][a-z0-9-]*$/.test(unit.path))
      throw new Error('Invalid build workspace path');
    return unit.path + '/dist';
  });
  paths.push('apps/web/public');
  const targets = [];
  // Validate every component before deletion: a junction must never redirect cleanup outside checkout.
  for (const path of paths) {
    const target = resolve(workspace, path),
      inside = relative(workspace, target);
    if (!inside || inside.startsWith('..' + sep) || isAbsolute(inside))
      throw new Error('Unsafe build output');
    let current = workspace;
    for (const component of inside.split(sep)) {
      current = resolve(current, component);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('Build output contains a symlink/junction');
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
    targets.push(target);
  }
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = resolve(root, 'node_modules/typescript/bin/tsc');

for (const group of ['apps', 'packages']) {
  const workspaces = readdirSync(resolve(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const workspace of workspaces) {
    const project = `${group}/${workspace.name}/tsconfig.json`;
    process.stdout.write(`Typecheck ${group}/${workspace.name}\n`);
    execFileSync(process.execPath, [compiler, '--project', project, '--pretty', 'false'], {
      cwd: root,
      stdio: 'inherit',
    });
  }
}

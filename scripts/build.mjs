import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const order = [
  'packages/domain',
  'packages/contracts',
  'packages/application',
  'packages/infrastructure',
  'packages/proget-compat',
  'packages/sdk',
  'apps/api',
  'apps/worker',
  'apps/scheduler',
  'apps/web',
];
for (const project of order) {
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', `${project}/tsconfig.build.json`],
    { stdio: 'inherit' },
  );
}

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [directory, role] = process.argv.slice(2);
if (role === 'exit') process.exit(0);
writeFileSync(join(directory, `${role}.json`), JSON.stringify({ pid: process.pid }));
if (role === 'parent') {
  spawn(process.execPath, [fileURLToPath(import.meta.url), directory, 'descendant'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  // The old runner returned immediately after SIGTERM, even if a child ignored it.
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  appendFileSync(join(directory, 'heartbeat'), '.');
  setInterval(() => appendFileSync(join(directory, 'heartbeat'), '.'), 20);
}

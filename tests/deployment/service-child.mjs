import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [root, role] = process.argv.slice(2);
const path = join(root, 'data', `${role}.starts`);
let starts = 0;
try {
  starts = Number(await readFile(path, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(path, String(starts + 1));
if (starts === 0) throw Error('Intentional first-start crash for service recovery gate');
const timer = setInterval(() => {}, 1000);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer);
  });

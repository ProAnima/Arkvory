import { readFile, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
const [root, role] = process.argv.slice(2);
await readFile(join(root, 'config/runtime.json'));
for (const name of ['config/bootstrap-token.txt', 'github-token.txt']) {
  let denied = false;
  try {
    await readFile(join(root, name));
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') denied = true;
    else throw error;
  }
  if (!denied) throw Error('Service identity must not read administrator credentials');
}
let writeDenied = false;
try {
  const file = await open(join(root, `forbidden-${role}`), 'wx');
  await file.close();
} catch (error) {
  if (error.code === 'EACCES' || error.code === 'EPERM') writeDenied = true;
  else throw error;
}
if (!writeDenied) throw Error('Service identity must not modify the installation');
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

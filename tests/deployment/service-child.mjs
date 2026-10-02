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
async function writeDenied(path) {
  try {
    const file = await open(path, 'wx');
    await file.close();
  } catch (error) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return true;
    throw error;
  }
  return false;
}
if (!(await writeDenied(join(root, `forbidden-${role}`))))
  throw Error('Service identity must not modify the installation');
// The backup unit sees storage read-only; only the vault opened by its drop-in is writable.
if (role === 'backup' && process.platform === 'linux' && !(await writeDenied(join(root, 'data/x'))))
  throw Error('The backup agent must not modify storage');
const path = join(root, role === 'backup' ? 'vault' : 'data', `${role}.starts`);
let starts = 0;
try {
  starts = Number(await readFile(path, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(path, String(starts + 1));
if (starts < 3) throw Error('Intentional repeated crash for service recovery gate');
const timer = setInterval(() => {}, 1000);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer);
  });

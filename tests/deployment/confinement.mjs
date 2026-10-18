import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Planted code: it leaves a file beside itself if anything ever runs it. */
const planted =
  "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'ran'), '');\nmodule.exports = () => ({});\n";

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * The packaged files with code planted where Node also looks for a bare name (ADR 0031,
 * addendum 2026-10-18): `node_modules` above the installation and the downloaded client files,
 * the home directory and NODE_PATH. ssh2 probes for its optional `cpu-features` when it loads;
 * the staged release goes without it, as on a host where npm left the optional package out.
 * `root` contains `output` (the artifact) and `target` (an installation of the release
 * `runtime` with installation.json and config/runtime.json).
 */
export async function checkConfinement({ root, output, target, runtime }) {
  const places = ['node_modules', 'home/.node_modules', 'global'].map((path) => join(root, path));
  for (const place of places) {
    await mkdir(join(place, 'cpu-features'), { recursive: true });
    await writeFile(join(place, 'cpu-features', 'index.js'), planted);
  }
  await rm(join(runtime, 'node_modules', 'cpu-features'), { recursive: true, force: true });
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    NODE_PATH: join(root, 'global'),
  };
  const node = (args) => execFileSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
  const ran = async () => {
    const found = [];
    for (const place of places) {
      const marker = join(place, 'cpu-features', 'ran');
      if (await exists(marker)) found.push(place);
      await rm(marker, { force: true });
    }
    return found;
  };
  // Without confinement the release's own ssh2 runs the planted code: the check is not vacuous.
  const ssh2 = `require(${JSON.stringify(join(runtime, 'node_modules', 'ssh2'))});`;
  node(['-e', ssh2]);
  assert.deepEqual(await ran(), [places[0]]);
  // Remote Setup bundles ssh2 and leaves cpu-features to the directory it is started from.
  const client = join(root, 'client');
  await mkdir(client);
  for (const name of ['arkvory-remote.mjs', 'arkvoryctl.mjs'])
    await copyFile(join(output, name), join(client, name));
  assert.match(node([join(client, 'arkvory-remote.mjs'), '--help']), /Remote Setup/);
  assert.equal(
    JSON.parse(node([join(client, 'arkvoryctl.mjs'), '--version'])).version,
    JSON.parse(await readFile(join(output, 'arkvory-release.json'), 'utf8')).version,
  );
  // The same wizard unbundled in the release confines itself to the release.
  assert.match(node([join(runtime, 'apps/deploy/dist/remote-main.js'), '--help']), /Remote Setup/);
  // The service launcher and the deploy CLI keep working confined, as bundles in the root.
  const vault = join(root, 'confined vault');
  node([join(runtime, 'deploy/launcher.mjs'), target, 'vault-init', vault]);
  assert.equal(
    JSON.parse(await readFile(join(vault, 'vault.json'), 'utf8')).format,
    'arkvory-vault',
  );
  node([join(runtime, 'deploy/manage.mjs'), 'status', '--root', target]);
  node([join(output, 'arkvory-setup.mjs'), 'status', '--root', target]);
  assert.deepEqual(await ran(), [], 'refused code must never run');
}

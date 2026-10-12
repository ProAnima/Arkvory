import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { jsonFile } from './files.js';
import { report } from './output.js';

/**
 * What a new data node needs from the cluster, in one file (ADR 0072): the resource, the ids of
 * the service accounts (files on the volume belong to them) and the units, drop-ins included.
 * Written on the active node; a replacement node joins with it without taking the volume, so
 * the active node keeps serving while the new disk resynchronizes.
 */
export interface NodeKit {
  readonly format: 'arkvory-node-kit/1';
  readonly root: string;
  readonly resource: string;
  readonly accounts: Readonly<Record<string, { readonly uid: number; readonly gid: number }>>;
  /** Unit file path below /etc/systemd/system → its text. */
  readonly units: Readonly<Record<string, string>>;
}

const kitDirectory = (root: string) => join(root, 'config', 'cluster');
const unitPath = /^arkvory-[a-z0-9.@-]+(\.d\/[a-z0-9.@-]+\.conf)?$/;

async function unitTexts(directory: string): Promise<Record<string, string>> {
  const units: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith('arkvory-')) continue;
    if (!entry.isDirectory()) {
      units[entry.name] = await readFile(join(directory, entry.name), 'utf8');
      continue;
    }
    for (const dropIn of await readdir(join(directory, entry.name)))
      units[`${entry.name}/${dropIn}`] = await readFile(
        join(directory, entry.name, dropIn),
        'utf8',
      );
  }
  return units;
}

/** `arkvory cluster-kit --output <file>` on the active node. */
export async function writeKitFile(root: string, output: string): Promise<void> {
  const settings = (await jsonFile(join(root, 'config', 'cluster.json'))) as {
    resource?: unknown;
  } | null;
  if (typeof settings?.resource !== 'string')
    throw new Error('This installation is no cluster node: run cluster-kit on the active node');
  const kit: NodeKit = {
    format: 'arkvory-node-kit/1',
    root,
    resource: settings.resource,
    accounts: (await jsonFile(join(kitDirectory(root), 'accounts.json'))) as NodeKit['accounts'],
    units: await unitTexts(join(kitDirectory(root), 'units')),
  };
  // No secret inside, but the ids and units are the cluster's: readable by root only.
  await writeFile(output, JSON.stringify(kit, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  report(
    'info',
    `Copy ${output} to the new node and run "arkvory cluster-node --kit <file>" there`,
  );
}

/** A kit file, checked: an invalid one is refused before anything on this node changes. */
export async function readKitFile(file: string): Promise<NodeKit> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is no node kit`, { cause: error });
  }
  const kit = value as Partial<NodeKit> | null;
  const accountsValid = Object.values(kit?.accounts ?? {}).every(
    (ids) => Number.isInteger(ids.uid) && Number.isInteger(ids.gid),
  );
  const unitsValid = Object.entries(kit?.units ?? {}).every(
    ([path, text]) => unitPath.test(path) && typeof text === 'string',
  );
  if (
    kit?.format !== 'arkvory-node-kit/1' ||
    typeof kit.root !== 'string' ||
    typeof kit.resource !== 'string' ||
    !/^[a-z][a-z0-9-]{0,30}$/.test(kit.resource) ||
    !accountsValid ||
    !unitsValid
  )
    throw new Error(`${file} is no node kit of this release`);
  return kit as NodeKit;
}

/** Writes the kit's units below `units`; the paths were checked by readKitFile. */
export async function installKitUnits(kit: NodeKit, units: string): Promise<void> {
  for (const [path, text] of Object.entries(kit.units)) {
    await mkdir(dirname(join(units, path)), { recursive: true });
    await writeFile(join(units, path), text, { mode: 0o644 });
  }
}

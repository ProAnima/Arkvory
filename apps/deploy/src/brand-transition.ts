import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonFile } from './files.js';
import { record } from './model.js';

/** A fresh Compose project or SCM name must not strand data from a previous installation. */
export async function assertArkvoryInstallation(root: string): Promise<void> {
  try {
    const config = record(await jsonFile(join(root, 'config/runtime.json')));
    if (Object.keys(config).some((key) => key.startsWith('DEPOT_')))
      throw new Error(
        'Legacy Depot installation: complete the supervised handover in docs/RENAMING.md before using the Arkvory installer/updater. Data has not been changed.',
      );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export async function assertNoLegacyDefault(): Promise<void> {
  const legacy =
    process.platform === 'win32'
      ? join(
          process.env['ProgramData'] ?? 'C:\\ProgramData',
          'ProAnima',
          'Depot',
          'installation.json',
        )
      : '/opt/proanima-depot/installation.json';
  try {
    await access(legacy);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    'Existing Depot installation detected. Follow docs/RENAMING.md; a second empty storage will not be installed.',
  );
}

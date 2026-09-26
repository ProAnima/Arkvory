import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './release-files.mjs';

export const nativeFiles = [
  'Arkvory-Setup-x64.exe',
  'Arkvory-amd64.deb',
  'Arkvory-x86_64.rpm',
  'Arkvory-CLI-Setup-x64.exe',
  'Arkvory-CLI-amd64.deb',
  'Arkvory-CLI-x86_64.rpm',
  'native-win32.json',
  'native-linux.json',
];
export async function verifyNativeFiles(
  directory,
  version,
  commit,
  platforms = ['win32', 'linux'],
) {
  for (const platform of platforms) {
    const names =
      platform === 'win32'
        ? ['Arkvory-Setup-x64.exe', 'Arkvory-CLI-Setup-x64.exe']
        : [
            'Arkvory-amd64.deb',
            'Arkvory-x86_64.rpm',
            'Arkvory-CLI-amd64.deb',
            'Arkvory-CLI-x86_64.rpm',
          ];
    const manifest = JSON.parse(await readFile(join(directory, `native-${platform}.json`), 'utf8'));
    if (
      manifest.version !== version ||
      manifest.commit !== commit ||
      JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(names.sort())
    )
      throw Error('Native inventory identity mismatch');
    for (const name of names) {
      const info = await lstat(join(directory, name));
      if (
        !info.isFile() ||
        info.size > 1024 ** 3 ||
        info.size < 1024 ||
        (await sha256(join(directory, name))) !== manifest.files[name]
      )
        throw Error(`Invalid native asset: ${name}`);
    }
  }
}

import { mkdir, copyFile, readFile, writeFile, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tarExecutable } from './tar.mjs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { releaseFiles, sha256 } from './release-files.mjs';

export async function packageInstallers(output, staging, release) {
  const common = ['arkvory-runtime.zip', 'arkvory-setup.mjs', 'arkvory-release.json'];
  for (const platform of ['Windows', 'Linux']) {
    const directory = join(staging, `installer-${platform}`);
    await mkdir(directory);
    const launchers = [];
    const installer = platform === 'Windows' ? 'install.ps1' : 'install.sh';
    const files = [...common, installer, 'START-HERE.md', ...launchers];
    for (const name of common) await copyFile(join(output, name), join(directory, name));
    await copyFile(join('deploy', installer), join(directory, installer));
    for (const name of ['START-HERE.md', ...launchers])
      await copyFile(join('deploy/click', name), join(directory, name));
    for (const name of files) {
      const path = join(directory, name);
      if (name.endsWith('.ps1')) {
        // Windows PowerShell 5 needs a BOM for localized prompts; scripts remain UTF-8 in Git.
        await writeFile(path, '\uFEFF' + (await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
      }
      if (name.endsWith('.cmd'))
        await writeFile(path, (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n'));
      if (name.endsWith('.sh') || name.endsWith('.desktop')) await chmod(path, 0o755);
    }
    if (platform === 'Windows') {
      const zip = new ZipFile();
      const done = pipeline(
        zip.outputStream,
        createWriteStream(join(output, 'Arkvory-Windows.zip'), { flags: 'wx' }),
      );
      for (const name of files) zip.addFile(join(directory, name), name);
      zip.end();
      await done;
    } else
      execFileSync(
        tarExecutable(),
        ['-czf', join(output, 'Arkvory-Linux.tar.gz'), '-C', directory, ...files],
        {
          stdio: 'inherit',
        },
      );
  }
  const files = {};
  for (const name of releaseFiles) files[name] = await sha256(join(output, name));
  await writeFile(
    join(output, 'release-checksums.json'),
    JSON.stringify(
      { format: 1, version: release.version, commit: release.commit, files },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}

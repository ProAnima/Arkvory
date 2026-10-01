import assert from 'node:assert/strict';
import { readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tarExecutable } from './tar.mjs';
import { sha256 } from './release-files.mjs';

export async function verifyInstallers(output, root, extract) {
  const windows = join(root, 'bundle Windows'),
    linux = join(root, 'bundle Linux');
  await extract(join(output, 'Arkvory-Windows.zip'), windows);
  await mkdir(linux);
  execFileSync(tarExecutable(), ['-xzf', join(output, 'Arkvory-Linux.tar.gz'), '-C', linux]);
  for (const directory of [windows, linux]) {
    for (const name of ['arkvory-runtime.zip', 'arkvory-setup.mjs', 'arkvory-release.json'])
      assert.equal(
        await sha256(join(directory, name)),
        await sha256(join(output, name)),
        `Bundle differs: ${name}`,
      );
    await access(join(directory, 'START-HERE.md'));
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  for (const name of ['install.ps1']) {
    const path = join(windows, name);
    assert.equal((await readFile(path))[0], 0xef, 'PowerShell 5 localized bundle needs UTF-8 BOM');
    execFileSync(
      process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:ARKVORY_PARSE_PATH,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }',
      ],
      { env: { ...environment, ARKVORY_PARSE_PATH: path }, stdio: 'inherit', windowsHide: true },
    );
  }
  const bash =
    process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git/bin/bash.exe') : 'bash';
  for (const name of ['install.sh'])
    execFileSync(bash, ['-n', join(linux, name)], { stdio: 'inherit', windowsHide: true });

  console.log('Installation bundles preserve tested bytes; launchers pass native shell parsers');
}

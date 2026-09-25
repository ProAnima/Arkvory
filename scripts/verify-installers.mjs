import assert from 'node:assert/strict';
import { readFile, mkdir, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha256 } from './release-files.mjs';

export async function verifyInstallers(output, root, extract) {
  const windows = join(root, 'bundle Windows'),
    linux = join(root, 'bundle Linux');
  await extract(join(output, 'Depot-Windows.zip'), windows);
  await mkdir(linux);
  execFileSync('tar', ['-xzf', join(output, 'Depot-Linux.tar.gz'), '-C', linux]);
  for (const directory of [windows, linux]) {
    for (const name of ['depot-runtime.zip', 'depot-setup.mjs', 'depot-release.json'])
      assert.equal(
        await sha256(join(directory, name)),
        await sha256(join(output, name)),
        `Bundle differs: ${name}`,
      );
    await access(join(directory, 'START-HERE.md'));
  }
  for (const name of ['Setup-Windows.cmd', 'Setup-Docker.cmd']) {
    const cmd = await readFile(join(windows, name), 'utf8');
    assert.ok(cmd.includes('"%~dp0setup.ps1"'));
    assert.ok(cmd.includes('\r\n'));
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  for (const name of ['setup.ps1', 'install.ps1']) {
    const path = join(windows, name);
    assert.equal((await readFile(path))[0], 0xef, 'PowerShell 5 localized bundle needs UTF-8 BOM');
    execFileSync(
      process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:DEPOT_PARSE_PATH,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }',
      ],
      { env: { ...environment, DEPOT_PARSE_PATH: path }, stdio: 'inherit', windowsHide: true },
    );
  }
  const bash =
    process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git/bin/bash.exe') : 'bash';
  for (const name of ['setup.sh', 'install.sh'])
    execFileSync(bash, ['-n', join(linux, name)], { stdio: 'inherit', windowsHide: true });
  if (process.platform === 'linux') await verifyDesktopLaunchers(linux, root);
  console.log('Installation bundles preserve tested bytes; launchers pass native shell parsers');
}

async function verifyDesktopLaunchers(bundle, root) {
  const directory = join(root, 'desktop with spaces $literal');
  await mkdir(directory);
  const result = join(directory, 'result');
  await writeFile(join(directory, 'setup.sh'), 'printf \'%s\' "$1" > "$DEPOT_LAUNCH_RESULT"\n');
  for (const [name, mode] of [
    ['Setup-Linux.desktop', 'systemd'],
    ['Setup-Docker.desktop', 'compose'],
  ]) {
    const desktop = await readFile(join(bundle, name), 'utf8');
    const command = /^Exec=python3 -c "([^"\r\n]+)" %k (systemd|compose)$/m.exec(desktop);
    assert.ok(command, 'Desktop launcher must pass the location as a separate argument');
    assert.equal(command[2], mode);
    for (const path of [join(directory, name), pathToFileURL(join(directory, name)).href]) {
      execFileSync('python3', ['-c', command[1], path, mode], {
        env: { ...process.env, DEPOT_LAUNCH_RESULT: result },
      });
      assert.equal(await readFile(result, 'utf8'), mode);
    }
  }
}
